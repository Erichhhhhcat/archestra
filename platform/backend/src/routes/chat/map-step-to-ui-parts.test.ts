/**
 * Tests for mapStepContentToUIMessageParts.
 *
 * Verifies that the mapping from AI SDK ContentPart[] (onStepFinish)
 * produces the exact same UIMessage part format as toUIMessageStream (onFinish).
 *
 * Reference format (from real DB rows saved by onFinish / toUIMessageStream):
 *
 * Text:       { type: "text", text: "...", state: "done" }
 * Step start: { type: "step-start" }
 * Tool call:  { type: "tool-{toolName}", toolCallId, state: "input-available", input, callProviderMetadata? }
 * Tool result: { type: "tool-{toolName}", toolCallId, state: "output-available", input, output, callProviderMetadata? }
 * Tool error: { type: "tool-{toolName}", toolCallId, state: "output-error", input, errorText, callProviderMetadata? }
 */

import { describe, expect, it } from "vitest";
import {
  mapStepContentToUIMessageParts,
  type StepContentPart,
} from "./map-step-to-ui-parts";

describe("mapStepContentToUIMessageParts", () => {
  describe("step-start marker", () => {
    it("adds step-start before each step", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts([{ type: "text", text: "Hello" }], parts);

      expect(parts[0]).toEqual({ type: "step-start" });
    });

    it("adds step-start for every step call", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts([{ type: "text", text: "Step 1" }], parts);
      mapStepContentToUIMessageParts([{ type: "text", text: "Step 2" }], parts);

      expect(parts[0]).toEqual({ type: "step-start" });
      expect(parts[2]).toEqual({ type: "step-start" });
    });
  });

  describe("text parts", () => {
    it("maps text ContentPart to UIMessage text part", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [{ type: "text", text: "Hello world" }],
        parts,
      );

      expect(parts[1]).toEqual({ type: "text", text: "Hello world" });
    });

    it("skips empty text parts", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts([{ type: "text", text: "" }], parts);

      // Only step-start, no text part
      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({ type: "step-start" });
    });
  });

  describe("tool-call parts", () => {
    it("maps tool-call to tool-{toolName} with input-available state", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_123",
            toolName: "microsoft__playwright-mcp__browser_navigate",
            input: { url: "https://example.com" },
          },
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "tool-microsoft__playwright-mcp__browser_navigate",
        toolCallId: "tc_123",
        state: "input-available",
        input: { url: "https://example.com" },
      });
    });

    it("includes callProviderMetadata when providerMetadata is present", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_456",
            toolName: "archestra__todo_write",
            input: { todos: [] },
            providerMetadata: { anthropic: { caller: { type: "direct" } } },
          },
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "tool-archestra__todo_write",
        toolCallId: "tc_456",
        state: "input-available",
        input: { todos: [] },
        callProviderMetadata: { anthropic: { caller: { type: "direct" } } },
      });
    });

    it("omits callProviderMetadata when providerMetadata is absent", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_789",
            toolName: "search",
            input: { query: "test" },
          },
        ],
        parts,
      );

      expect(parts[1]).not.toHaveProperty("callProviderMetadata");
    });
  });

  describe("tool-result parts", () => {
    it("updates matching tool part to output-available state", () => {
      const parts: Record<string, unknown>[] = [];

      // Step 1: tool call + tool result in same step
      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_100",
            toolName: "search",
            input: { query: "AI" },
          },
          {
            type: "tool-result",
            toolCallId: "tc_100",
            toolName: "search",
            output: "Search results...",
          },
        ],
        parts,
      );

      // Tool part should be updated in place
      expect(parts[1]).toEqual({
        type: "tool-search",
        toolCallId: "tc_100",
        state: "output-available",
        input: { query: "AI" },
        output: "Search results...",
      });
    });

    it("preserves callProviderMetadata when updating to output-available", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_200",
            toolName: "fetch",
            input: { url: "https://example.com" },
            providerMetadata: { anthropic: { caller: { type: "direct" } } },
          },
          {
            type: "tool-result",
            toolCallId: "tc_200",
            toolName: "fetch",
            output: "<html>...</html>",
          },
        ],
        parts,
      );

      expect(parts[1].callProviderMetadata).toEqual({
        anthropic: { caller: { type: "direct" } },
      });
      expect(parts[1].state).toBe("output-available");
    });

    it("handles tool-result arriving in a later step", () => {
      const parts: Record<string, unknown>[] = [];

      // Step 1: tool call only
      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_300",
            toolName: "long_running_tool",
            input: { task: "process" },
          },
        ],
        parts,
      );

      expect(parts[1].state).toBe("input-available");

      // Step 2: tool result arrives
      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-result",
            toolCallId: "tc_300",
            toolName: "long_running_tool",
            output: "Done!",
          },
          { type: "text", text: "The task is complete." },
        ],
        parts,
      );

      // Original tool part (index 1) should be updated
      expect(parts[1].state).toBe("output-available");
      expect(parts[1].output).toBe("Done!");
    });
  });

  describe("tool-error parts", () => {
    it("updates matching tool part to output-error state with string error", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_400",
            toolName: "browser_click",
            input: { ref: "e22" },
          },
          {
            type: "tool-error",
            toolCallId: "tc_400",
            toolName: "browser_click",
            error: "Timeout 5000ms exceeded",
          },
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "tool-browser_click",
        toolCallId: "tc_400",
        state: "output-error",
        input: { ref: "e22" },
        errorText: "Timeout 5000ms exceeded",
      });
    });

    it("converts Error object to errorText", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_500",
            toolName: "browser_click",
            input: { ref: "e10" },
          },
          {
            type: "tool-error",
            toolCallId: "tc_500",
            toolName: "browser_click",
            error: new Error("Element not found"),
          },
        ],
        parts,
      );

      expect(parts[1].state).toBe("output-error");
      expect(parts[1].errorText).toBe("Element not found");
    });

    it("JSON-stringifies object errors", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_600",
            toolName: "api_call",
            input: {},
          },
          {
            type: "tool-error",
            toolCallId: "tc_600",
            toolName: "api_call",
            error: { code: "TIMEOUT", message: "Request timed out" },
          },
        ],
        parts,
      );

      expect(parts[1].state).toBe("output-error");
      expect(parts[1].errorText).toBe(
        '{"code":"TIMEOUT","message":"Request timed out"}',
      );
    });
  });

  describe("multi-step agentic scenarios", () => {
    it("produces correct format for a multi-step agentic loop", () => {
      const parts: Record<string, unknown>[] = [];

      // Step 1: LLM calls a tool
      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_a",
            toolName: "microsoft__playwright-mcp__browser_navigate",
            input: { url: "https://acurio.vc" },
            providerMetadata: { anthropic: { caller: { type: "direct" } } },
          },
          {
            type: "tool-result",
            toolCallId: "tc_a",
            toolName: "microsoft__playwright-mcp__browser_navigate",
            output: "[Page snapshot here]",
          },
        ],
        parts,
      );

      // Step 2: LLM calls another tool then responds with text
      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_b",
            toolName: "archestra__todo_write",
            input: { todos: [{ id: 1, content: "Research fund" }] },
            providerMetadata: { anthropic: { caller: { type: "direct" } } },
          },
          {
            type: "tool-result",
            toolCallId: "tc_b",
            toolName: "archestra__todo_write",
            output: "Successfully wrote 1 todo item(s)",
          },
        ],
        parts,
      );

      // Step 3: LLM responds with text
      mapStepContentToUIMessageParts(
        [{ type: "text", text: "I've completed my research." }],
        parts,
      );

      // Verify the complete structure
      expect(parts).toEqual([
        // Step 1
        { type: "step-start" },
        {
          type: "tool-microsoft__playwright-mcp__browser_navigate",
          toolCallId: "tc_a",
          state: "output-available",
          input: { url: "https://acurio.vc" },
          output: "[Page snapshot here]",
          callProviderMetadata: { anthropic: { caller: { type: "direct" } } },
        },
        // Step 2
        { type: "step-start" },
        {
          type: "tool-archestra__todo_write",
          toolCallId: "tc_b",
          state: "output-available",
          input: { todos: [{ id: 1, content: "Research fund" }] },
          output: "Successfully wrote 1 todo item(s)",
          callProviderMetadata: { anthropic: { caller: { type: "direct" } } },
        },
        // Step 3
        { type: "step-start" },
        { type: "text", text: "I've completed my research." },
      ]);
    });

    it("handles multiple tool calls within a single step", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "tc_1",
            toolName: "search",
            input: { query: "topic A" },
          },
          {
            type: "tool-call",
            toolCallId: "tc_2",
            toolName: "search",
            input: { query: "topic B" },
          },
          {
            type: "tool-result",
            toolCallId: "tc_1",
            toolName: "search",
            output: "Results for A",
          },
          {
            type: "tool-result",
            toolCallId: "tc_2",
            toolName: "search",
            output: "Results for B",
          },
        ],
        parts,
      );

      // Both tool parts should be output-available
      expect(parts[1].toolCallId).toBe("tc_1");
      expect(parts[1].state).toBe("output-available");
      expect(parts[2].toolCallId).toBe("tc_2");
      expect(parts[2].state).toBe("output-available");
    });

    it("matches real DB format from toUIMessageStream", () => {
      // This test uses the exact format observed in a real working conversation
      // (7df16938) saved by onFinish / toUIMessageStream
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "tool-call",
            toolCallId: "toolu_01PqyxvUKThQwoJvXQHJpJJu",
            toolName: "microsoft__playwright-mcp__browser_navigate",
            input: { url: "https://acurio.vc" },
            providerMetadata: { anthropic: { caller: { type: "direct" } } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_01PqyxvUKThQwoJvXQHJpJJu",
            toolName: "microsoft__playwright-mcp__browser_navigate",
            output: "[Page https://www.acurio.vc/ browser_navigate was here]",
          },
        ],
        parts,
      );

      // Compare against actual DB row format from the working conversation
      const expectedToolPart = {
        type: "tool-microsoft__playwright-mcp__browser_navigate",
        toolCallId: "toolu_01PqyxvUKThQwoJvXQHJpJJu",
        state: "output-available",
        input: { url: "https://acurio.vc" },
        output: "[Page https://www.acurio.vc/ browser_navigate was here]",
        callProviderMetadata: { anthropic: { caller: { type: "direct" } } },
      };

      expect(parts[1]).toEqual(expectedToolPart);
    });
  });

  describe("reasoning parts", () => {
    it("maps reasoning to UIMessage reasoning part with state done", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [{ type: "reasoning", text: "Let me think about this..." }],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "reasoning",
        text: "Let me think about this...",
        providerMetadata: undefined,
        state: "done",
      });
    });

    it("includes providerMetadata when present", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "reasoning",
            text: "Thinking...",
            providerMetadata: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "reasoning",
        text: "Thinking...",
        providerMetadata: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
        state: "done",
      });
    });
  });

  describe("source parts", () => {
    it("maps source with sourceType url to source-url part", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "source",
            sourceType: "url",
            id: "src_1",
            url: "https://example.com/article",
            title: "Example Article",
          } as StepContentPart,
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "source-url",
        sourceId: "src_1",
        url: "https://example.com/article",
        title: "Example Article",
        providerMetadata: undefined,
      });
    });

    it("maps source with sourceType document to source-document part", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "source",
            sourceType: "document",
            id: "src_2",
            mediaType: "application/pdf",
            title: "Report.pdf",
            filename: "report.pdf",
          } as StepContentPart,
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "source-document",
        sourceId: "src_2",
        mediaType: "application/pdf",
        title: "Report.pdf",
        filename: "report.pdf",
        providerMetadata: undefined,
      });
    });

    it("sets optional fields to undefined when absent on source-url", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "source",
            sourceType: "url",
            id: "src_3",
            url: "https://example.com",
          } as StepContentPart,
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "source-url",
        sourceId: "src_3",
        url: "https://example.com",
        title: undefined,
        providerMetadata: undefined,
      });
    });

    it("sets optional filename to undefined when absent on source-document", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "source",
            sourceType: "document",
            id: "src_4",
            mediaType: "text/plain",
            title: "Notes",
          } as StepContentPart,
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "source-document",
        sourceId: "src_4",
        mediaType: "text/plain",
        title: "Notes",
        filename: undefined,
        providerMetadata: undefined,
      });
    });
  });

  describe("file parts", () => {
    it("maps file to UIMessage file part with data URL", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          {
            type: "file",
            file: { base64: "iVBORw0KGgo=", mediaType: "image/png" },
          } as StepContentPart,
        ],
        parts,
      );

      expect(parts[1]).toEqual({
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,iVBORw0KGgo=",
      });
    });
  });

  describe("multi-step with all part types", () => {
    it("handles reasoning, sources, files, text, and tools across steps", () => {
      const parts: Record<string, unknown>[] = [];

      // Step 1: reasoning + tool call with result
      mapStepContentToUIMessageParts(
        [
          { type: "reasoning", text: "I should search for this." },
          {
            type: "tool-call",
            toolCallId: "tc_mix",
            toolName: "search",
            input: { query: "test" },
          },
          {
            type: "tool-result",
            toolCallId: "tc_mix",
            toolName: "search",
            output: "Found results",
          },
        ],
        parts,
      );

      // Step 2: text + source + file
      mapStepContentToUIMessageParts(
        [
          { type: "text", text: "Here are the results." },
          {
            type: "source",
            sourceType: "url",
            id: "s1",
            url: "https://example.com",
            title: "Source",
          } as StepContentPart,
          {
            type: "file",
            file: { base64: "AAAA", mediaType: "image/jpeg" },
          } as StepContentPart,
        ],
        parts,
      );

      expect(parts).toEqual([
        // Step 1
        { type: "step-start" },
        {
          type: "reasoning",
          text: "I should search for this.",
          providerMetadata: undefined,
          state: "done",
        },
        {
          type: "tool-search",
          toolCallId: "tc_mix",
          state: "output-available",
          input: { query: "test" },
          output: "Found results",
        },
        // Step 2
        { type: "step-start" },
        { type: "text", text: "Here are the results." },
        {
          type: "source-url",
          sourceId: "s1",
          url: "https://example.com",
          title: "Source",
          providerMetadata: undefined,
        },
        {
          type: "file",
          mediaType: "image/jpeg",
          url: "data:image/jpeg;base64,AAAA",
        },
      ]);
    });
  });

  describe("unknown part types", () => {
    it("ignores unknown part types gracefully", () => {
      const parts: Record<string, unknown>[] = [];

      mapStepContentToUIMessageParts(
        [
          { type: "some-future-type" } as StepContentPart,
          { type: "text", text: "Result" },
        ],
        parts,
      );

      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: "step-start" });
      expect(parts[1]).toEqual({ type: "text", text: "Result" });
    });
  });
});
