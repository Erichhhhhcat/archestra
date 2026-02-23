import { expect, test } from "./fixtures";

test.describe("Chat Conversations - Pin/Unpin", () => {
  test("can pin and unpin a conversation", async ({
    request,
    makeApiRequest,
    createAgent,
    deleteAgent,
  }) => {
    const agentResponse = await createAgent(request, "Pin Test Agent");
    const agent = await agentResponse.json();

    try {
      // Create a conversation
      const convResponse = await makeApiRequest({
        request,
        method: "post",
        urlSuffix: "/api/chat/conversations",
        data: {
          agentId: agent.id,
          selectedModel: "gpt-4o",
        },
      });
      const conversation = await convResponse.json();
      expect(conversation.pinnedAt).toBeNull();

      // Pin the conversation
      const pinResponse = await makeApiRequest({
        request,
        method: "patch",
        urlSuffix: `/api/chat/conversations/${conversation.id}`,
        data: {
          pinnedAt: new Date().toISOString(),
        },
      });
      const pinnedConv = await pinResponse.json();
      expect(pinnedConv.pinnedAt).not.toBeNull();

      // Verify it appears as pinned when fetching
      const getResponse = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: `/api/chat/conversations/${conversation.id}`,
      });
      const fetchedConv = await getResponse.json();
      expect(fetchedConv.pinnedAt).not.toBeNull();

      // Unpin the conversation
      const unpinResponse = await makeApiRequest({
        request,
        method: "patch",
        urlSuffix: `/api/chat/conversations/${conversation.id}`,
        data: {
          pinnedAt: null,
        },
      });
      const unpinnedConv = await unpinResponse.json();
      expect(unpinnedConv.pinnedAt).toBeNull();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test("pinned conversations appear in list with pinnedAt set", async ({
    request,
    makeApiRequest,
    createAgent,
    deleteAgent,
  }) => {
    const agentResponse = await createAgent(request, "Pin List Test Agent");
    const agent = await agentResponse.json();

    try {
      // Create two conversations
      const conv1Response = await makeApiRequest({
        request,
        method: "post",
        urlSuffix: "/api/chat/conversations",
        data: { agentId: agent.id, selectedModel: "gpt-4o" },
      });
      const conv1 = await conv1Response.json();

      const conv2Response = await makeApiRequest({
        request,
        method: "post",
        urlSuffix: "/api/chat/conversations",
        data: { agentId: agent.id, selectedModel: "gpt-4o" },
      });
      const conv2 = await conv2Response.json();

      // Pin only the first conversation
      await makeApiRequest({
        request,
        method: "patch",
        urlSuffix: `/api/chat/conversations/${conv1.id}`,
        data: { pinnedAt: new Date().toISOString() },
      });

      // List all conversations
      const listResponse = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: "/api/chat/conversations",
      });
      const conversations = await listResponse.json();

      const pinnedConv = conversations.find(
        (c: { id: string }) => c.id === conv1.id,
      );
      const unpinnedConv = conversations.find(
        (c: { id: string }) => c.id === conv2.id,
      );

      expect(pinnedConv).toBeDefined();
      expect(pinnedConv.pinnedAt).not.toBeNull();
      expect(unpinnedConv).toBeDefined();
      expect(unpinnedConv.pinnedAt).toBeNull();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test("rejects invalid pinnedAt value", async ({
    request,
    makeApiRequest,
    createAgent,
    deleteAgent,
  }) => {
    const agentResponse = await createAgent(request, "Pin Validation Agent");
    const agent = await agentResponse.json();

    try {
      const convResponse = await makeApiRequest({
        request,
        method: "post",
        urlSuffix: "/api/chat/conversations",
        data: { agentId: agent.id, selectedModel: "gpt-4o" },
      });
      const conversation = await convResponse.json();

      // Send a non-date string that can't be coerced
      const response = await makeApiRequest({
        request,
        method: "patch",
        urlSuffix: `/api/chat/conversations/${conversation.id}`,
        data: { pinnedAt: "not-a-date" },
        ignoreStatusCheck: true,
      });

      expect(response.status()).toBe(400);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test("returns 404 for non-existent conversation", async ({
    request,
    makeApiRequest,
  }) => {
    const response = await makeApiRequest({
      request,
      method: "patch",
      urlSuffix: "/api/chat/conversations/00000000-0000-4000-8000-000000000000",
      data: { pinnedAt: new Date().toISOString() },
      ignoreStatusCheck: true,
    });

    expect(response.status()).toBe(404);
  });
});
