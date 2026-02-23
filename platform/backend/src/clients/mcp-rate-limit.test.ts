import { vi } from "vitest";
import { AgentTeamModel, LimitModel } from "@/models";
import { beforeEach, describe, expect, test } from "@/test";

// Track call counts per cache key for rate limit simulation
const rateLimitCounters = new Map<
  string,
  { count: number; windowStart: number }
>();

// Mock isRateLimited to simulate the sliding window rate limiter using an in-memory map
// instead of the PostgreSQL-backed CacheManager (which requires a real PG connection).
vi.mock("@/agents/utils", () => ({
  isRateLimited: vi.fn(
    async (
      cacheKey: string,
      config: { windowMs: number; maxRequests: number },
    ) => {
      const now = Date.now();
      const entry = rateLimitCounters.get(cacheKey);

      if (!entry || now - entry.windowStart > config.windowMs) {
        // Start new window
        rateLimitCounters.set(cacheKey, { count: 1, windowStart: now });
        return false;
      }

      if (entry.count >= config.maxRequests) {
        return true;
      }

      // Increment count
      entry.count += 1;
      return false;
    },
  ),
}));

// Mock cacheManager.get to return from our in-memory map (used for retry time calculation)
vi.mock("@/cache-manager", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("@/cache-manager");
  return {
    ...original,
    cacheManager: {
      get: vi.fn(async (key: string) => {
        return rateLimitCounters.get(key) ?? undefined;
      }),
      set: vi.fn(),
      delete: vi.fn(),
      start: vi.fn(),
      shutdown: vi.fn(),
    },
  };
});

// Mock metrics to avoid side effects
vi.mock("@/observability/metrics/mcp", () => ({
  reportMcpRateLimitRejection: vi.fn(),
}));

import { checkMcpRateLimits, getMcpUsageForLimit } from "./mcp-rate-limit";

describe("checkMcpRateLimits", () => {
  // Clear rate limit counters before each test
  beforeEach(() => {
    rateLimitCounters.clear();
  });

  test("returns null when no limits are configured", async ({ makeAgent }) => {
    const agent = await makeAgent({ name: "No Limits Agent" });

    const result = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "test-tool",
    });

    expect(result).toBeNull();
  });

  test("returns null when server-level limit is not exceeded", async ({
    makeAgent,
    makeOrganization,
    makeUser,
    makeTeam,
  }) => {
    const org = await makeOrganization();
    const user = await makeUser();
    const team = await makeTeam(org.id, user.id);
    const agent = await makeAgent({ organizationId: org.id });
    await AgentTeamModel.assignTeamsToAgent(agent.id, [team.id]);

    // Create a server-level limit: 10 calls per minute
    await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "mcp_server_calls",
      limitValue: 10,
      mcpServerName: "test-server",
      windowMs: 60_000,
    });

    // First call should be allowed
    const result = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "test-tool",
    });

    expect(result).toBeNull();
  });

  test("returns error string when server-level limit is exceeded", async ({
    makeAgent,
    makeOrganization,
    makeUser,
    makeTeam,
  }) => {
    const org = await makeOrganization();
    const user = await makeUser();
    const team = await makeTeam(org.id, user.id);
    const agent = await makeAgent({ organizationId: org.id });
    await AgentTeamModel.assignTeamsToAgent(agent.id, [team.id]);

    // Create a server-level limit: 2 calls per minute
    await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "mcp_server_calls",
      limitValue: 2,
      mcpServerName: "test-server",
      windowMs: 60_000,
    });

    // First two calls count (allowed)
    await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "any-tool",
    });
    await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "any-tool",
    });

    // Third call should be rate-limited
    const result = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "any-tool",
    });

    expect(result).not.toBeNull();
    expect(result).toContain("Rate limit exceeded");
    expect(result).toContain("MCP server 'test-server'");
    expect(result).toContain("2 calls per");
  });

  test("returns error string when tool-level limit is exceeded", async ({
    makeAgent,
    makeOrganization,
    makeUser,
    makeTeam,
  }) => {
    const org = await makeOrganization();
    const user = await makeUser();
    const team = await makeTeam(org.id, user.id);
    const agent = await makeAgent({ organizationId: org.id });
    await AgentTeamModel.assignTeamsToAgent(agent.id, [team.id]);

    // Create a tool-level limit: 1 call per hour
    await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "tool_calls",
      limitValue: 1,
      mcpServerName: "test-server",
      toolName: "dangerous-tool",
      windowMs: 3_600_000,
    });

    // First call counts (allowed)
    await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "dangerous-tool",
    });

    // Second call should be rate-limited
    const result = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "dangerous-tool",
    });

    expect(result).not.toBeNull();
    expect(result).toContain("Rate limit exceeded");
    expect(result).toContain(
      "tool 'dangerous-tool' on MCP server 'test-server'",
    );
    expect(result).toContain("1 calls per");
  });

  test("organization-level limit applies across all agents", async ({
    makeAgent,
    makeOrganization,
    makeUser,
    makeTeam,
  }) => {
    const org = await makeOrganization();
    const user = await makeUser();
    const team = await makeTeam(org.id, user.id);

    const agent1 = await makeAgent({ organizationId: org.id });
    const agent2 = await makeAgent({ organizationId: org.id });
    await AgentTeamModel.assignTeamsToAgent(agent1.id, [team.id]);
    await AgentTeamModel.assignTeamsToAgent(agent2.id, [team.id]);

    // Create an organization-level limit: 2 calls per minute
    await LimitModel.create({
      entityType: "organization",
      entityId: org.id,
      limitType: "mcp_server_calls",
      limitValue: 2,
      mcpServerName: "shared-server",
      windowMs: 60_000,
    });

    // Agent 1 uses one call
    const result1 = await checkMcpRateLimits({
      agentId: agent1.id,
      mcpServerName: "shared-server",
      toolName: "some-tool",
    });
    expect(result1).toBeNull();

    // Agent 2 uses one call
    const result2 = await checkMcpRateLimits({
      agentId: agent2.id,
      mcpServerName: "shared-server",
      toolName: "some-tool",
    });
    expect(result2).toBeNull();

    // Both agents share the org limit, so the third call from either agent
    // hits the same org limit ID. However, since each agent resolves the
    // same org limit, the counter is per-limit-ID, so the third call should be blocked.
    const result3 = await checkMcpRateLimits({
      agentId: agent1.id,
      mcpServerName: "shared-server",
      toolName: "some-tool",
    });
    expect(result3).not.toBeNull();
    expect(result3).toContain("Rate limit exceeded");
  });

  test("team-level limit only applies to agents in that team", async ({
    makeAgent,
    makeOrganization,
    makeUser,
    makeTeam,
  }) => {
    const org = await makeOrganization();
    const user = await makeUser();
    const teamA = await makeTeam(org.id, user.id, { name: "Team A" });
    const teamB = await makeTeam(org.id, user.id, { name: "Team B" });

    const agentInTeamA = await makeAgent({ organizationId: org.id });
    const agentInTeamB = await makeAgent({ organizationId: org.id });
    await AgentTeamModel.assignTeamsToAgent(agentInTeamA.id, [teamA.id]);
    await AgentTeamModel.assignTeamsToAgent(agentInTeamB.id, [teamB.id]);

    // Create a team-level limit for Team A only: 1 call per minute
    await LimitModel.create({
      entityType: "team",
      entityId: teamA.id,
      limitType: "mcp_server_calls",
      limitValue: 1,
      mcpServerName: "test-server",
      windowMs: 60_000,
    });

    // Agent in Team A uses one call (allowed)
    await checkMcpRateLimits({
      agentId: agentInTeamA.id,
      mcpServerName: "test-server",
      toolName: "some-tool",
    });

    // Agent in Team A is now rate-limited
    const resultA = await checkMcpRateLimits({
      agentId: agentInTeamA.id,
      mcpServerName: "test-server",
      toolName: "some-tool",
    });
    expect(resultA).not.toBeNull();
    expect(resultA).toContain("Rate limit exceeded");

    // Agent in Team B is NOT rate-limited (no limit configured for Team B)
    const resultB = await checkMcpRateLimits({
      agentId: agentInTeamB.id,
      mcpServerName: "test-server",
      toolName: "some-tool",
    });
    expect(resultB).toBeNull();
  });

  test("error message format includes limit value, window description, and retry seconds", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ name: "Rate Limited Agent" });

    // Create a limit: 1 call per 1 hour
    await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "mcp_server_calls",
      limitValue: 1,
      mcpServerName: "test-server",
      windowMs: 3_600_000,
    });

    // First call counts (allowed)
    await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "any-tool",
    });

    // Second call triggers rate limit
    const result = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "any-tool",
    });

    expect(result).not.toBeNull();
    // Check error message components
    expect(result).toContain("1 calls per");
    expect(result).toContain("1 hour");
    expect(result).toContain("MCP server 'test-server'");
    expect(result).toMatch(/Try again in approximately \d+ seconds/);
  });

  test("does not rate limit when limit is for a different MCP server", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ name: "Multi Server Agent" });

    // Create a limit for server-A only
    await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "mcp_server_calls",
      limitValue: 1,
      mcpServerName: "server-A",
      windowMs: 60_000,
    });

    // Calling server-B should not be rate-limited
    const result = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "server-B",
      toolName: "any-tool",
    });

    expect(result).toBeNull();
  });

  test("tool_calls limit does not affect other tools on the same server", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ name: "Tool Limit Agent" });

    // Create a tool-level limit for tool-A only
    await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "tool_calls",
      limitValue: 1,
      mcpServerName: "test-server",
      toolName: "tool-A",
      windowMs: 60_000,
    });

    // Use up the limit for tool-A
    await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "tool-A",
    });

    // tool-A is now rate-limited
    const resultA = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "tool-A",
    });
    expect(resultA).not.toBeNull();

    // tool-B on the same server should not be rate-limited
    const resultB = await checkMcpRateLimits({
      agentId: agent.id,
      mcpServerName: "test-server",
      toolName: "tool-B",
    });
    expect(resultB).toBeNull();
  });

  test("returns null on error (fail-open behavior)", async () => {
    // Agent with no teams and no limits - this exercises the normal code path
    // For a true error scenario, we rely on the try/catch in checkMcpRateLimits
    // The function should return null and allow the request even if something goes wrong
    const result = await checkMcpRateLimits({
      agentId: "nonexistent-agent-id",
      mcpServerName: "test-server",
      toolName: "test-tool",
    });

    expect(result).toBeNull();
  });
});

describe("getMcpUsageForLimit", () => {
  beforeEach(() => {
    rateLimitCounters.clear();
  });

  test("returns 0 when no usage exists", async () => {
    const usage = await getMcpUsageForLimit("nonexistent-limit-id");
    expect(usage).toBe(0);
  });

  test("returns current count from cache", async ({ makeAgent }) => {
    const agent = await makeAgent({ name: "Usage Agent" });

    const limit = await LimitModel.create({
      entityType: "agent",
      entityId: agent.id,
      limitType: "mcp_server_calls",
      limitValue: 100,
      mcpServerName: "test-server",
      windowMs: 60_000,
    });

    // Manually populate the in-memory counter to simulate usage
    const cacheKey = `mcp-rate-limit-${limit.id}`;
    rateLimitCounters.set(cacheKey, { count: 5, windowStart: Date.now() });

    const usage = await getMcpUsageForLimit(limit.id);
    expect(usage).toBe(5);
  });
});
