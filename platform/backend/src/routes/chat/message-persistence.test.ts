/**
 * Tests for chat message persistence behavior.
 *
 * These tests verify the progressive save approach:
 * 1. User messages are saved on the first onStepFinish call (not pre-saved before streaming)
 * 2. A draft assistant message is created on the first step and updated on subsequent steps
 * 3. onFinish atomically updates the draft with the proper UIMessage content (no delete-then-create)
 * 4. If onFinish never fires (crash, error), the draft survives with partial content
 * 5. Falls back to count-based dedup when no steps completed
 */

import { describe, expect } from "vitest";
import ConversationModel from "@/models/conversation";
import MessageModel from "@/models/message";
import { test } from "@/test";
import { mapStepContentToUIMessageParts } from "./map-step-to-ui-parts";

/**
 * Helper to create a UIMessage-like object matching the structure used by the chat route.
 */
function makeUIMessage(role: "user" | "assistant", text: string) {
  return {
    id: crypto.randomUUID(),
    role,
    content: text,
    parts: [{ type: "text", text }],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Simulates the onStepFinish save logic from routes.chat.ts.
 * On the first call, saves new user messages and creates a draft assistant message.
 * On subsequent calls, updates the draft with accumulated content.
 *
 * Returns the updated state (draftAssistantMessageId, userMessagesSaved, accumulatedParts)
 * so the caller can chain multiple steps.
 */
async function simulateOnStepFinishSave(
  conversationId: string,
  stepContent: Array<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: unknown;
      }
  >,
  state: {
    incomingMessages: ReturnType<typeof makeUIMessage>[];
    preSaveExistingCount: number;
    draftAssistantMessageId: string | null;
    userMessagesSaved: boolean;
    // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts are dynamic
    accumulatedParts: any[];
  },
) {
  // Save user messages on first step
  if (!state.userMessagesSaved) {
    state.userMessagesSaved = true;
    const newIncomingMessages = state.incomingMessages.slice(
      state.preSaveExistingCount,
    );
    const newUserMessages = newIncomingMessages.filter(
      (m) => m.role === "user",
    );
    if (newUserMessages.length > 0) {
      await MessageModel.bulkCreate(
        newUserMessages.map((msg) => ({
          conversationId,
          role: "user" as const,
          content: msg,
        })),
      );
    }
  }

  // Map step content to UIMessage-compatible parts (same format as toUIMessageStream)
  mapStepContentToUIMessageParts(stepContent, state.accumulatedParts);

  // Build UIMessage-like object for DB storage
  const assistantContent = {
    id: state.draftAssistantMessageId || crypto.randomUUID(),
    role: "assistant",
    parts: [...state.accumulatedParts],
    createdAt: new Date().toISOString(),
  };

  if (!state.draftAssistantMessageId) {
    const created = await MessageModel.create({
      conversationId,
      role: "assistant",
      content: assistantContent,
    });
    state.draftAssistantMessageId = created.id;
  } else {
    await MessageModel.updateContent(
      state.draftAssistantMessageId,
      assistantContent,
    );
  }

  return state;
}

/**
 * Simulates the onFinish callback logic from routes.chat.ts.
 * When a draft exists, atomically updates it with the proper UIMessage content.
 * When no draft exists, falls back to count-based dedup.
 */
async function simulateOnFinishSave(
  conversationId: string,
  finalMessages: ReturnType<typeof makeUIMessage>[],
  state: {
    draftAssistantMessageId: string | null;
    userMessagesSaved: boolean;
    incomingMessages: ReturnType<typeof makeUIMessage>[];
    preSaveExistingCount: number;
  },
) {
  if (state.draftAssistantMessageId) {
    // Atomically update the draft with the proper UIMessage content
    const lastAssistant = [...finalMessages]
      .reverse()
      .find((m) => m.role === "assistant");

    if (lastAssistant) {
      await MessageModel.updateContent(
        state.draftAssistantMessageId,
        lastAssistant,
      );
    }

    state.draftAssistantMessageId = null;

    // Edge case: save user messages if onStepFinish never fired
    if (!state.userMessagesSaved) {
      state.userMessagesSaved = true;
      const newIncomingMessages = state.incomingMessages.slice(
        state.preSaveExistingCount,
      );
      const newUserMessages = newIncomingMessages.filter(
        (m) => m.role === "user",
      );
      if (newUserMessages.length > 0) {
        await MessageModel.bulkCreate(
          newUserMessages.map((msg) => ({
            conversationId,
            role: "user" as const,
            content: msg,
          })),
        );
      }
    }
  } else {
    // No steps completed — fall back to count-based dedup
    const existingMessages =
      await MessageModel.findByConversation(conversationId);
    const existingCount = existingMessages.length;
    const newMessages = finalMessages.slice(existingCount);

    if (newMessages.length > 0) {
      let messagesToSave = newMessages;
      if (newMessages[newMessages.length - 1].parts.length === 0) {
        messagesToSave = newMessages.slice(0, -1);
      }

      if (messagesToSave.length > 0) {
        await MessageModel.bulkCreate(
          messagesToSave.map((msg) => ({
            conversationId,
            role: msg.role ?? "assistant",
            content: msg,
          })),
        );
      }
    }
  }
}

/**
 * Helper to create a fresh step state for chaining onStepFinish calls.
 */
function makeStepState(
  incomingMessages: ReturnType<typeof makeUIMessage>[],
  preSaveExistingCount: number,
) {
  return {
    incomingMessages,
    preSaveExistingCount,
    draftAssistantMessageId: null as string | null,
    userMessagesSaved: false,
    // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts are dynamic
    accumulatedParts: [] as any[],
  };
}

describe("chat message persistence", () => {
  describe("first step saves user messages and creates draft", () => {
    test("first onStepFinish saves user message and creates draft assistant", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      const userMessage = makeUIMessage("user", "Hello");
      const state = makeStepState([userMessage], 0);

      // First step: LLM responds with text
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "Hi there!" }],
        state,
      );

      const messages = await MessageModel.findByConversation(conversation.id);

      // Should have 2 messages: user + draft assistant
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
      expect(state.draftAssistantMessageId).toBeTruthy();
    });

    test("user message survives when onFinish never fires (the 50-step scenario)", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: null,
        selectedModel: "claude-opus-4-5-20251101",
      });

      const userMessage = makeUIMessage("user", "Research AI companies");
      const state = makeStepState([userMessage], 0);

      // First step fires — saves user message + creates draft
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "I'll research AI companies..." }],
        state,
      );

      // Stream runs for many steps but crashes — onFinish never fires

      const messages = await MessageModel.findByConversation(conversation.id);

      // At minimum, both user message and draft assistant survive
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });
  });

  describe("subsequent steps update draft content", () => {
    test("second step updates draft with accumulated content", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      const userMessage = makeUIMessage("user", "Search for info");
      const state = makeStepState([userMessage], 0);

      // Step 1: tool call
      await simulateOnStepFinishSave(
        conversation.id,
        [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            input: { query: "AI" },
          },
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            output: "Search results...",
          },
        ],
        state,
      );

      const afterStep1 = await MessageModel.findByConversation(conversation.id);
      expect(afterStep1).toHaveLength(2);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion on dynamic content
      const step1Parts = (afterStep1[1].content as any).parts;
      // step-start + tool-search (output-available) = 2 parts
      expect(step1Parts).toHaveLength(2);
      expect(step1Parts[0]).toEqual({ type: "step-start" });
      expect(step1Parts[1].type).toBe("tool-search");
      expect(step1Parts[1].state).toBe("output-available");

      // Step 2: LLM summarizes results
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "Based on the results..." }],
        state,
      );

      const afterStep2 = await MessageModel.findByConversation(conversation.id);
      // Still 2 messages — draft was updated in place
      expect(afterStep2).toHaveLength(2);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion on dynamic content
      const step2Parts = (afterStep2[1].content as any).parts;
      // step1: step-start + tool-search, step2: step-start + text = 4 parts
      expect(step2Parts).toHaveLength(4);
      expect(step2Parts[2]).toEqual({ type: "step-start" });
      expect(step2Parts[3].type).toBe("text");
      expect(step2Parts[3].text).toBe("Based on the results...");
    });
  });

  describe("onFinish atomically updates draft", () => {
    test("onFinish updates draft to proper UIMessage format", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      const userMessage = makeUIMessage("user", "Hello");
      const state = makeStepState([userMessage], 0);

      // Step 1
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "Hi!" }],
        state,
      );

      const draftId = state.draftAssistantMessageId;
      expect(draftId).toBeTruthy();

      // onFinish fires with the proper UIMessage
      const finalAssistant = makeUIMessage("assistant", "Hi there!");
      await simulateOnFinishSave(
        conversation.id,
        [userMessage, finalAssistant],
        {
          draftAssistantMessageId: state.draftAssistantMessageId,
          userMessagesSaved: state.userMessagesSaved,
          incomingMessages: [userMessage],
          preSaveExistingCount: 0,
        },
      );

      const messages = await MessageModel.findByConversation(conversation.id);

      // Still 2 messages — draft was updated, not deleted and recreated
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
      // The draft row persists with the same ID
      expect(messages[1].id).toBe(draftId);
      // Content is the final UIMessage, not the draft
      // biome-ignore lint/suspicious/noExplicitAny: test assertion on dynamic content
      const content = messages[1].content as any;
      expect(content.parts[0].text).toBe("Hi there!");
    });

    test("onFinish falls back to count-based dedup when no steps completed", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      const userMessage = makeUIMessage("user", "Hello");
      const assistant = makeUIMessage("assistant", "Hi!");

      // No onStepFinish ever fired — go straight to onFinish
      await simulateOnFinishSave(conversation.id, [userMessage, assistant], {
        draftAssistantMessageId: null,
        userMessagesSaved: false,
        incomingMessages: [userMessage],
        preSaveExistingCount: 0,
      });

      const messages = await MessageModel.findByConversation(conversation.id);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });
  });

  describe("multi-turn conversations", () => {
    test("second turn works correctly after first turn completes", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      // Turn 1
      const msg1 = makeUIMessage("user", "What is 2+2?");
      const state1 = makeStepState([msg1], 0);
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "4" }],
        state1,
      );
      const msg2 = makeUIMessage("assistant", "4");
      await simulateOnFinishSave(conversation.id, [msg1, msg2], {
        draftAssistantMessageId: state1.draftAssistantMessageId,
        userMessagesSaved: state1.userMessagesSaved,
        incomingMessages: [msg1],
        preSaveExistingCount: 0,
      });

      const afterTurn1 = await MessageModel.findByConversation(conversation.id);
      expect(afterTurn1).toHaveLength(2);

      // Turn 2: preSaveExistingCount = 2 (user + assistant from turn 1)
      const msg3 = makeUIMessage("user", "And 3+3?");
      const state2 = makeStepState([msg1, msg2, msg3], 2);
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "6" }],
        state2,
      );
      const msg4 = makeUIMessage("assistant", "6");
      await simulateOnFinishSave(conversation.id, [msg1, msg2, msg3, msg4], {
        draftAssistantMessageId: state2.draftAssistantMessageId,
        userMessagesSaved: state2.userMessagesSaved,
        incomingMessages: [msg1, msg2, msg3],
        preSaveExistingCount: 2,
      });

      const afterTurn2 = await MessageModel.findByConversation(conversation.id);
      expect(afterTurn2).toHaveLength(4);
      expect(afterTurn2[2].role).toBe("user");
      expect(afterTurn2[3].role).toBe("assistant");
    });

    test("draft survives when onFinish never fires on second turn", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      // Turn 1: completes normally
      const msg1 = makeUIMessage("user", "Hello");
      const state1 = makeStepState([msg1], 0);
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "Hi!" }],
        state1,
      );
      const msg2 = makeUIMessage("assistant", "Hi!");
      await simulateOnFinishSave(conversation.id, [msg1, msg2], {
        draftAssistantMessageId: state1.draftAssistantMessageId,
        userMessagesSaved: state1.userMessagesSaved,
        incomingMessages: [msg1],
        preSaveExistingCount: 0,
      });

      // Turn 2: step fires but onFinish never fires (crash)
      const msg3 = makeUIMessage("user", "Write me an essay");
      const state2 = makeStepState([msg1, msg2, msg3], 2);
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "I'll write an essay about..." }],
        state2,
      );

      // Pod crashes — onFinish never fires

      const messages = await MessageModel.findByConversation(conversation.id);

      // 4 messages: turn1 user + turn1 assistant + turn2 user + turn2 draft assistant
      expect(messages).toHaveLength(4);
      expect(messages[2].role).toBe("user");
      expect(messages[3].role).toBe("assistant");
    });
  });

  describe("regenerate scenario (no new user messages)", () => {
    test("regenerate does not duplicate user message", async ({
      makeUser,
      makeOrganization,
      makeAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeAgent({ organizationId: org.id });

      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Test",
        selectedModel: "claude-3-haiku-20240307",
      });

      // Turn 1: complete
      const msg1 = makeUIMessage("user", "Hello");
      const state1 = makeStepState([msg1], 0);
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "Hi!" }],
        state1,
      );
      const msg2 = makeUIMessage("assistant", "Hi!");
      await simulateOnFinishSave(conversation.id, [msg1, msg2], {
        draftAssistantMessageId: state1.draftAssistantMessageId,
        userMessagesSaved: state1.userMessagesSaved,
        incomingMessages: [msg1],
        preSaveExistingCount: 0,
      });

      // Regenerate: same incoming messages (user only), preSaveExistingCount = 1
      // (assistant message was deleted by frontend before regenerate)
      const state2 = makeStepState([msg1], 1);
      await simulateOnStepFinishSave(
        conversation.id,
        [{ type: "text", text: "Hello! How can I help?" }],
        state2,
      );

      const messages = await MessageModel.findByConversation(conversation.id);

      // 3 messages: original user + original assistant (from turn 1) + new draft assistant
      // The user message was NOT duplicated because slice(1) on [msg1] = [] (no new user messages)
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe("user");
      expect(messages[2].role).toBe("assistant");
    });
  });
});
