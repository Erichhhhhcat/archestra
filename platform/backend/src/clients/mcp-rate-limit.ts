import { inArray } from "drizzle-orm";
import { isRateLimited, type RateLimitEntry } from "@/agents/utils";
import { type AllowedCacheKey, CacheKey, cacheManager } from "@/cache-manager";
import db, { schema } from "@/database";
import logger from "@/logging";
import { AgentTeamModel, LimitModel } from "@/models";
import { reportMcpRateLimitRejection } from "@/observability/metrics/mcp";
import type { Limit } from "@/types";

/**
 * Check MCP rate limits for a tool call before execution.
 *
 * Checks limits in priority order: agent → team → organization,
 * for both mcp_server_calls and tool_calls limit types.
 *
 * @returns null if allowed, or an error message string if rate-limited
 */
export async function checkMcpRateLimits(params: {
  agentId: string;
  mcpServerName: string;
  toolName: string;
}): Promise<string | null> {
  const { agentId, mcpServerName, toolName } = params;

  try {
    // Get agent's teams
    const agentTeamIds = await AgentTeamModel.getTeamsForAgent(agentId);

    // Resolve organization ID from teams
    let organizationId: string | null = null;
    if (agentTeamIds.length > 0) {
      const teams = await db
        .select({ organizationId: schema.teamsTable.organizationId })
        .from(schema.teamsTable)
        .where(inArray(schema.teamsTable.id, agentTeamIds))
        .limit(1);
      if (teams.length > 0) {
        organizationId = teams[0].organizationId;
      }
    }

    // Collect all applicable limits: agent-level, team-level, organization-level
    const applicableLimits: Limit[] = [];

    // 1. Agent-level limits
    const agentLimits = await LimitModel.findAll("agent", agentId);
    applicableLimits.push(...agentLimits);

    // 2. Team-level limits
    for (const teamId of agentTeamIds) {
      const teamLimits = await LimitModel.findAll("team", teamId);
      applicableLimits.push(...teamLimits);
    }

    // 3. Organization-level limits
    if (organizationId) {
      const orgLimits = await LimitModel.findAll(
        "organization",
        organizationId,
      );
      applicableLimits.push(...orgLimits);
    }

    // Filter to only MCP-related limits that match this server/tool
    const mcpLimits = applicableLimits.filter((limit) => {
      if (
        limit.limitType === "mcp_server_calls" &&
        limit.mcpServerName === mcpServerName &&
        limit.windowMs
      ) {
        return true;
      }
      if (
        limit.limitType === "tool_calls" &&
        limit.mcpServerName === mcpServerName &&
        limit.toolName === toolName &&
        limit.windowMs
      ) {
        return true;
      }
      return false;
    });

    if (mcpLimits.length === 0) {
      return null;
    }

    // Check each limit
    for (const limit of mcpLimits) {
      const cacheKey =
        `${CacheKey.McpRateLimit}-${limit.id}` as AllowedCacheKey;
      const windowMs = limit.windowMs as number; // Guaranteed non-null by filter above

      const rateLimited = await isRateLimited(cacheKey, {
        windowMs,
        maxRequests: limit.limitValue,
      });

      if (rateLimited) {
        // Calculate approximate retry time
        const entry = await cacheManager.get<RateLimitEntry>(cacheKey);
        const remainingMs = entry
          ? Math.max(0, windowMs - (Date.now() - entry.windowStart))
          : windowMs;
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        const windowDescription = formatWindowMs(windowMs);
        const limitTarget =
          limit.limitType === "tool_calls"
            ? `tool '${toolName}' on MCP server '${mcpServerName}'`
            : `MCP server '${mcpServerName}'`;

        // Report metric
        reportMcpRateLimitRejection({
          agentId,
          agentName: agentId, // Use agentId as agentName for metrics to avoid extra DB query
          mcpServerName,
          toolName,
          limitType: limit.limitType,
          entityType: limit.entityType,
        });

        logger.info(
          {
            limitId: limit.id,
            agentId,
            mcpServerName,
            toolName,
            limitType: limit.limitType,
            entityType: limit.entityType,
          },
          `MCP rate limit exceeded for ${limitTarget}`,
        );

        return `Rate limit exceeded for ${limitTarget}: ${limit.limitValue} calls per ${windowDescription}. Try again in approximately ${remainingSeconds} seconds.`;
      }
    }

    return null;
  } catch (error) {
    logger.error(
      { error, agentId, mcpServerName, toolName },
      "Error checking MCP rate limits, allowing request",
    );
    // Allow request on error to avoid blocking tool calls due to rate limit infrastructure issues
    return null;
  }
}

/**
 * Get the current usage count for a specific MCP rate limit.
 * Used by the API to display usage on the frontend.
 */
export async function getMcpUsageForLimit(limitId: string): Promise<number> {
  const cacheKey = `${CacheKey.McpRateLimit}-${limitId}` as AllowedCacheKey;
  const entry = await cacheManager.get<RateLimitEntry>(cacheKey);
  return entry?.count ?? 0;
}

// --- Internal helpers ---

function formatWindowMs(windowMs: number): string {
  const seconds = windowMs / 1000;
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = hours / 24;
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""}`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks !== 1 ? "s" : ""}`;
  }
  const months = Math.round(days / 30);
  return `${months} month${months !== 1 ? "s" : ""}`;
}
