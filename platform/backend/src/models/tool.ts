import {
  AGENT_TOOL_PREFIX,
  MCP_SERVER_TOOL_NAME_SEPARATOR,
  slugify,
  TOOL_ARTIFACT_WRITE_FULL_NAME,
  TOOL_QUERY_KNOWLEDGE_GRAPH_FULL_NAME,
  TOOL_TODO_WRITE_FULL_NAME,
} from "@shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notIlike,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getArchestraMcpTools } from "@/archestra-mcp-server";
import db, { schema } from "@/database";
import {
  createPaginatedResult,
  type PaginatedResult,
} from "@/database/utils/pagination";
import { getKnowledgeGraphProviderType } from "@/knowledge-graph";
import type {
  ExtendedTool,
  InsertTool,
  Tool,
  ToolFilters,
  ToolSortBy,
  ToolSortDirection,
  ToolWithAssignments,
  UpdateTool,
} from "@/types";
import McpServerModel from "./mcp-server";
import ProfileTeamModel from "./profile-team";
import ProfileToolModel from "./profile-tool";
import ToolInvocationPolicyModel from "./tool-invocation-policy";
import TrustedDataPolicyModel from "./trusted-data-policy";

class ToolModel {
  /**
   * Slugify a tool name to get a unique name for the MCP server's tool.
   * Ensures the result matches the pattern ^[a-zA-Z0-9_-]{1,128}$ required by LLM providers.
   */
  static slugifyName(mcpServerName: string, toolName: string): string {
    return `${mcpServerName}${MCP_SERVER_TOOL_NAME_SEPARATOR}${toolName}`
      .toLowerCase()
      .replace(/\s+/g, "_") // Replace whitespace with underscores
      .replace(/[^a-z0-9_-]/g, ""); // Remove any characters not allowed in tool names
  }

  /**
   * Unslugify a tool name to get the original tool name
   */
  static unslugifyName(slugifiedName: string): string {
    const parts = slugifiedName.split(MCP_SERVER_TOOL_NAME_SEPARATOR);
    return parts.length > 1
      ? parts.slice(1).join(MCP_SERVER_TOOL_NAME_SEPARATOR)
      : slugifiedName;
  }

  static async create(tool: InsertTool): Promise<Tool> {
    const [createdTool] = await db
      .insert(schema.toolsTable)
      .values(tool)
      .returning();
    return createdTool;
  }

  static async update(
    id: string,
    data: Partial<
      Pick<
        UpdateTool,
        | "policiesAutoConfiguredAt"
        | "policiesAutoConfiguringStartedAt"
        | "policiesAutoConfiguredReasoning"
      >
    >,
  ): Promise<Tool | null> {
    const [updatedTool] = await db
      .update(schema.toolsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.toolsTable.id, id))
      .returning();
    return updatedTool || null;
  }

  static async createToolIfNotExists(tool: InsertTool): Promise<Tool> {
    // For Archestra built-in tools (both profileId and catalogId are null), check if tool already exists
    // This prevents duplicate Archestra tools since NULL != NULL in unique constraints
    if (!tool.profileId && !tool.catalogId) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          and(
            isNull(schema.toolsTable.profileId),
            isNull(schema.toolsTable.catalogId),
            eq(schema.toolsTable.name, tool.name),
          ),
        );

      if (existingTool) {
        return existingTool;
      }
    }

    // For proxy-sniffed tools (profileId is set, catalogId is null), check if tool already exists
    // This prevents duplicate proxy-sniffed tools for the same profile
    if (tool.profileId && !tool.catalogId) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          and(
            eq(schema.toolsTable.profileId, tool.profileId),
            eq(schema.toolsTable.name, tool.name),
            isNull(schema.toolsTable.catalogId),
          ),
        );

      if (existingTool) {
        return existingTool;
      }
    }

    // For MCP tools (profileId is null, catalogId is set), check if tool with same catalog and name already exists
    // This allows multiple installations of the same catalog to share tool definitions
    if (!tool.profileId && tool.catalogId) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          and(
            isNull(schema.toolsTable.profileId),
            eq(schema.toolsTable.catalogId, tool.catalogId),
            eq(schema.toolsTable.name, tool.name),
          ),
        );

      if (existingTool) {
        return existingTool;
      }
    }

    const [createdTool] = await db
      .insert(schema.toolsTable)
      .values(tool)
      .onConflictDoNothing()
      .returning();

    // If tool already exists (conflict), fetch it
    if (!createdTool) {
      const [existingTool] = await db
        .select()
        .from(schema.toolsTable)
        .where(
          tool.profileId
            ? and(
                eq(schema.toolsTable.profileId, tool.profileId),
                eq(schema.toolsTable.name, tool.name),
              )
            : tool.catalogId
              ? and(
                  isNull(schema.toolsTable.profileId),
                  eq(schema.toolsTable.catalogId, tool.catalogId),
                  eq(schema.toolsTable.name, tool.name),
                )
              : and(
                  isNull(schema.toolsTable.profileId),
                  isNull(schema.toolsTable.catalogId),
                  eq(schema.toolsTable.name, tool.name),
                ),
        );
      return existingTool;
    }

    // Create default policies for new tools
    await ToolModel.createDefaultPolicies(createdTool.id);

    return createdTool;
  }

  /**
   * Create default policies for a newly created tool:
   * - Default invocation policy: block_when_context_is_untrusted (empty conditions)
   * - Default result policy: mark_as_untrusted (empty conditions)
   */
  static async createDefaultPolicies(toolId: string): Promise<void> {
    // Create default invocation policy
    await ToolInvocationPolicyModel.create({
      toolId,
      conditions: [],
      action: "block_when_context_is_untrusted",
      reason: null,
    });

    // Create default result policy
    await TrustedDataPolicyModel.create({
      toolId,
      conditions: [],
      action: "mark_as_untrusted",
      description: null,
    });
  }

  static async findById(
    id: string,
    userId?: string,
    isAgentAdmin?: boolean,
  ): Promise<Tool | null> {
    const [tool] = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.id, id));

    if (!tool) {
      return null;
    }

    // Check access control for non-profile admins
    if (tool.profileId && userId && !isAgentAdmin) {
      const hasAccess = await ProfileTeamModel.userHasProfileAccess(
        userId,
        tool.profileId,
        false,
      );
      if (!hasAccess) {
        return null;
      }
    }

    return tool;
  }

  static async findAll(
    userId?: string,
    isAgentAdmin?: boolean,
  ): Promise<ExtendedTool[]> {
    // Get all tools
    let query = db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        catalogId: schema.toolsTable.catalogId,
        parameters: schema.toolsTable.parameters,
        description: schema.toolsTable.description,
        createdAt: schema.toolsTable.createdAt,
        updatedAt: schema.toolsTable.updatedAt,
        promptAgentId: schema.toolsTable.promptAgentId,
        policiesAutoConfiguredAt: schema.toolsTable.policiesAutoConfiguredAt,
        policiesAutoConfiguringStartedAt:
          schema.toolsTable.policiesAutoConfiguringStartedAt,
        policiesAutoConfiguredReasoning:
          schema.toolsTable.policiesAutoConfiguredReasoning,
        profile: {
          id: schema.profilesTable.id,
          name: schema.profilesTable.name,
        },
        mcpServer: {
          id: schema.mcpServersTable.id,
          name: schema.mcpServersTable.name,
        },
      })
      .from(schema.toolsTable)
      .leftJoin(
        schema.profilesTable,
        eq(schema.toolsTable.profileId, schema.profilesTable.id),
      )
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .orderBy(desc(schema.toolsTable.createdAt))
      .$dynamic();

    /**
     * Apply access control filtering for users that are not profile admins
     *
     * If the user is not an admin, we basically allow them to see all tools that are assigned to profiles
     * they have access to, plus all "MCP tools" (tools that are not assigned to any profile).
     */
    if (userId && !isAgentAdmin) {
      const accessibleProfileIds =
        await ProfileTeamModel.getUserAccessibleProfileIds(userId, false);

      const mcpServerSourceClause = isNotNull(schema.toolsTable.mcpServerId);

      if (accessibleProfileIds.length === 0) {
        query = query.where(mcpServerSourceClause);
      } else {
        query = query.where(
          or(
            inArray(schema.toolsTable.profileId, accessibleProfileIds),
            mcpServerSourceClause,
          ),
        );
      }
    }

    return query;
  }

  static async findByName(
    name: string,
    userId?: string,
    isAgentAdmin?: boolean,
  ): Promise<Tool | null> {
    const [tool] = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.name, name));

    if (!tool) {
      return null;
    }

    // Check access control for non-admins
    if (tool.profileId && userId && !isAgentAdmin) {
      const hasAccess = await ProfileTeamModel.userHasProfileAccess(
        userId,
        tool.profileId,
        false,
      );
      if (!hasAccess) {
        return null;
      }
    }

    return tool;
  }

  /**
   * Get all tools for a profile (both proxy-sniffed and MCP tools)
   * Proxy-sniffed tools are those with profileId set directly
   * MCP tools are those assigned via the profile_tools junction table
   */
  static async getToolsByProfile(profileId: string): Promise<Tool[]> {
    // Get tool IDs assigned via junction table (MCP tools)
    const assignedToolIds =
      await ProfileToolModel.findToolIdsByProfile(profileId);

    // Query for tools that are either:
    // 1. Directly associated with the profile (proxy-sniffed, profileId set)
    // 2. Assigned via junction table (MCP tools, profileId is null)
    const conditions = [eq(schema.toolsTable.profileId, profileId)];

    if (assignedToolIds.length > 0) {
      conditions.push(inArray(schema.toolsTable.id, assignedToolIds));
    }

    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(or(...conditions))
      .orderBy(desc(schema.toolsTable.createdAt));

    return tools;
  }

  /**
   * Get only MCP tools assigned to a profile (those from connected MCP servers)
   * Includes: MCP server tools (catalogId set, including Archestra builtin tools)
   * Excludes: proxy-discovered tools (profileId set, catalogId null)
   *
   * Note: Archestra tools are no longer automatically assigned - they must be
   * explicitly assigned like any other MCP server tools.
   */
  static async getMcpToolsByProfile(profileId: string): Promise<Tool[]> {
    // Get tool IDs assigned via junction table (MCP tools)
    const assignedToolIds =
      await ProfileToolModel.findToolIdsByProfile(profileId);

    if (assignedToolIds.length === 0) {
      return [];
    }

    // Return tools that are assigned via junction table AND have catalogId set
    // This includes both regular MCP server tools and Archestra builtin tools
    // Excludes proxy-discovered tools which have profileId set and catalogId null
    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          inArray(schema.toolsTable.id, assignedToolIds),
          isNotNull(schema.toolsTable.catalogId),
        ),
      )
      .orderBy(desc(schema.toolsTable.createdAt));

    return tools;
  }

  /**
   * Bulk create tools for an MCP server (catalog-based tools)
   * Fetches existing tools in a single query, then bulk inserts only new tools
   * Returns all tools (existing + newly created) to avoid N+1 queries
   */
  static async bulkCreateToolsIfNotExists(
    tools: Array<{
      name: string;
      description: string | null;
      parameters: Record<string, unknown>;
      catalogId: string;
      mcpServerId: string;
    }>,
  ): Promise<Tool[]> {
    if (tools.length === 0) {
      return [];
    }

    // Group tools by catalogId (all tools should have the same catalogId in practice)
    const catalogId = tools[0].catalogId;
    const toolNames = tools.map((t) => t.name);

    // Fetch all existing tools for this catalog in a single query
    const existingTools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          isNull(schema.toolsTable.profileId),
          eq(schema.toolsTable.catalogId, catalogId),
          inArray(schema.toolsTable.name, toolNames),
        ),
      );

    const existingToolsByName = new Map(existingTools.map((t) => [t.name, t]));

    // Prepare tools to insert (only those that don't exist)
    const toolsToInsert: InsertTool[] = [];
    const resultTools: Tool[] = [];

    for (const tool of tools) {
      const existingTool = existingToolsByName.get(tool.name);
      if (existingTool) {
        resultTools.push(existingTool);
      } else {
        toolsToInsert.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          catalogId: tool.catalogId,
          mcpServerId: tool.mcpServerId,
          profileId: null,
        });
      }
    }

    // Bulk insert new tools if any
    if (toolsToInsert.length > 0) {
      const insertedTools = await db
        .insert(schema.toolsTable)
        .values(toolsToInsert)
        .onConflictDoNothing()
        .returning();

      // Create default policies for newly inserted tools
      for (const tool of insertedTools) {
        await ToolModel.createDefaultPolicies(tool.id);
      }

      // If some tools weren't inserted due to conflict, fetch them
      if (insertedTools.length < toolsToInsert.length) {
        const insertedNames = new Set(insertedTools.map((t) => t.name));
        const missingNames = toolsToInsert
          .filter((t) => !insertedNames.has(t.name))
          .map((t) => t.name);

        if (missingNames.length > 0) {
          const conflictTools = await db
            .select()
            .from(schema.toolsTable)
            .where(
              and(
                isNull(schema.toolsTable.profileId),
                eq(schema.toolsTable.catalogId, catalogId),
                inArray(schema.toolsTable.name, missingNames),
              ),
            );
          resultTools.push(...insertedTools, ...conflictTools);
        } else {
          resultTools.push(...insertedTools);
        }
      } else {
        resultTools.push(...insertedTools);
      }
    }

    // Return tools in the same order as input
    const resultToolsByName = new Map(resultTools.map((t) => [t.name, t]));
    return tools
      .map((t) => resultToolsByName.get(t.name))
      .filter((t): t is Tool => t !== undefined);
  }

  /**
   * Seed Archestra built-in tools in the database.
   * Creates the Archestra catalog entry if it doesn't exist (for FK constraint),
   * then creates/updates tools with the catalog ID.
   * Called during server startup to ensure Archestra tools exist.
   *
   * Also migrates any pre-existing "discovered" Archestra tools (catalog_id = NULL)
   * to use the proper catalog ID.
   */
  static async seedArchestraTools(catalogId: string): Promise<void> {
    // Ensure the Archestra catalog entry exists in the database for FK constraint
    // This is a no-op if the entry already exists
    await db
      .insert(schema.internalMcpCatalogTable)
      .values({
        id: catalogId,
        name: "Archestra",
        description:
          "Built-in Archestra tools for managing profiles, limits, policies, and MCP servers.",
        serverType: "builtin",
        requiresAuth: false,
      })
      .onConflictDoNothing();

    const archestraTools = getArchestraMcpTools();
    const archestraToolNames = archestraTools.map((t) => t.name);

    // Migrate pre-existing "discovered" Archestra tools (catalog_id = NULL) to use the catalog
    // This handles tools that were auto-discovered via proxy before the catalog was introduced
    await db
      .update(schema.toolsTable)
      .set({ catalogId })
      .where(
        and(
          isNull(schema.toolsTable.catalogId),
          isNull(schema.toolsTable.profileId),
          inArray(schema.toolsTable.name, archestraToolNames),
        ),
      );

    // Get all existing Archestra tools in a single query (now including migrated ones)
    const existingTools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          eq(schema.toolsTable.catalogId, catalogId),
          inArray(schema.toolsTable.name, archestraToolNames),
        ),
      );

    const existingToolsByName = new Map(existingTools.map((t) => [t.name, t]));

    // Prepare tools to insert (only those that don't exist)
    const toolsToInsert: InsertTool[] = [];

    for (const archestraTool of archestraTools) {
      const existingTool = existingToolsByName.get(archestraTool.name);
      if (!existingTool) {
        toolsToInsert.push({
          name: archestraTool.name,
          description: archestraTool.description || null,
          parameters: archestraTool.inputSchema,
          catalogId,
          profileId: null,
        });
      }
    }

    // Bulk insert new tools if any
    if (toolsToInsert.length > 0) {
      await db.insert(schema.toolsTable).values(toolsToInsert).returning();
    }
  }

  /**
   * Assign Archestra built-in tools to a profile.
   * Assumes tools have already been seeded via seedArchestraTools().
   */
  static async assignArchestraToolsToProfile(
    profileId: string,
    catalogId: string,
  ): Promise<void> {
    // Get all Archestra tools from the catalog
    const archestraTools = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.catalogId, catalogId));

    const toolIds = archestraTools.map((t) => t.id);

    // Assign all tools to profile in bulk to avoid N+1
    await ProfileToolModel.createManyIfNotExists(profileId, toolIds);
  }

  /**
   * Assign default Archestra tools to a profile.
   * These tools are automatically assigned to new profiles:
   * - artifact_write: for artifact management
   * - todo_write: for task tracking
   * - query_knowledge_graph: for querying the knowledge graph (only if configured)
   */
  static async assignDefaultArchestraToolsToProfile(
    profileId: string,
  ): Promise<void> {
    // Build the list of default tools
    const defaultToolNames = [
      TOOL_ARTIFACT_WRITE_FULL_NAME,
      TOOL_TODO_WRITE_FULL_NAME,
    ];

    // Add query_knowledge_graph if knowledge graph provider is configured
    if (getKnowledgeGraphProviderType()) {
      defaultToolNames.push(TOOL_QUERY_KNOWLEDGE_GRAPH_FULL_NAME);
    }

    const defaultTools = await db
      .select({ id: schema.toolsTable.id })
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.name, defaultToolNames));

    if (defaultTools.length === 0) {
      // Tools not yet seeded, skip assignment
      return;
    }

    const toolIds = defaultTools.map((t) => t.id);

    // Assign tools to profile in bulk
    await ProfileToolModel.createManyIfNotExists(profileId, toolIds);
  }

  /**
   * Get names of all MCP tools assigned to a profile
   * Used to prevent autodiscovery of tools already available via MCP servers
   */
  static async getMcpToolNamesByProfile(profileId: string): Promise<string[]> {
    const mcpTools = await db
      .select({
        name: schema.toolsTable.name,
      })
      .from(schema.toolsTable)
      .innerJoin(
        schema.profileToolsTable,
        eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
      )
      .where(
        and(
          eq(schema.profileToolsTable.profileId, profileId),
          isNotNull(schema.toolsTable.mcpServerId), // Only MCP tools
        ),
      );

    return mcpTools.map((tool) => tool.name);
  }

  /**
   * Get MCP tools assigned to a profile
   */
  static async getMcpToolsAssignedToProfile(
    toolNames: string[],
    profileId: string,
  ): Promise<
    Array<{
      toolName: string;
      responseModifierTemplate: string | null;
      mcpServerSecretId: string | null;
      mcpServerName: string | null;
      mcpServerCatalogId: string | null;
      mcpServerId: string | null;
      credentialSourceMcpServerId: string | null;
      executionSourceMcpServerId: string | null;
      useDynamicTeamCredential: boolean;
      catalogId: string | null;
      catalogName: string | null;
    }>
  > {
    if (toolNames.length === 0) {
      return [];
    }

    const mcpTools = await db
      .select({
        toolName: schema.toolsTable.name,
        responseModifierTemplate:
          schema.profileToolsTable.responseModifierTemplate,
        mcpServerSecretId: schema.mcpServersTable.secretId,
        mcpServerName: schema.mcpServersTable.name,
        mcpServerCatalogId: schema.mcpServersTable.catalogId,
        credentialSourceMcpServerId:
          schema.profileToolsTable.credentialSourceMcpServerId,
        executionSourceMcpServerId:
          schema.profileToolsTable.executionSourceMcpServerId,
        useDynamicTeamCredential:
          schema.profileToolsTable.useDynamicTeamCredential,
        mcpServerId: schema.mcpServersTable.id,
        catalogId: schema.toolsTable.catalogId,
        catalogName: schema.internalMcpCatalogTable.name,
      })
      .from(schema.toolsTable)
      .innerJoin(
        schema.profileToolsTable,
        eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
      )
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .leftJoin(
        schema.internalMcpCatalogTable,
        eq(schema.toolsTable.catalogId, schema.internalMcpCatalogTable.id),
      )
      .where(
        and(
          eq(schema.profileToolsTable.profileId, profileId),
          inArray(schema.toolsTable.name, toolNames),
          isNotNull(schema.toolsTable.catalogId), // Only MCP tools (have catalogId)
        ),
      );

    return mcpTools;
  }

  /**
   * Get all tools for a specific MCP server with their assignment counts and assigned profiles
   */
  static async findByMcpServerId(mcpServerId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      parameters: Record<string, unknown>;
      createdAt: Date;
      assignedProfileCount: number;
      assignedProfiles: Array<{ id: string; name: string }>;
    }>
  > {
    const tools = await db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        description: schema.toolsTable.description,
        parameters: schema.toolsTable.parameters,
        createdAt: schema.toolsTable.createdAt,
      })
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.mcpServerId, mcpServerId))
      .orderBy(desc(schema.toolsTable.createdAt));

    const toolIds = tools.map((tool) => tool.id);

    // Get all profile assignments for these tools in one query to avoid N+1
    const assignments = await db
      .select({
        toolId: schema.profileToolsTable.toolId,
        profileId: schema.profileToolsTable.profileId,
        profileName: schema.profilesTable.name,
      })
      .from(schema.profileToolsTable)
      .innerJoin(
        schema.profilesTable,
        eq(schema.profileToolsTable.profileId, schema.profilesTable.id),
      )
      .where(inArray(schema.profileToolsTable.toolId, toolIds));

    // Group assignments by tool ID
    const assignmentsByTool = new Map<
      string,
      Array<{ id: string; name: string }>
    >();

    for (const toolId of toolIds) {
      assignmentsByTool.set(toolId, []);
    }

    for (const assignment of assignments) {
      const toolAssignments = assignmentsByTool.get(assignment.toolId) || [];
      toolAssignments.push({
        id: assignment.profileId,
        name: assignment.profileName,
      });
      assignmentsByTool.set(assignment.toolId, toolAssignments);
    }

    // Build tools with their assigned profiles
    const toolsWithProfiles = tools.map((tool) => {
      const assignedProfiles = assignmentsByTool.get(tool.id) || [];

      return {
        ...tool,
        parameters: tool.parameters ?? {},
        assignedProfileCount: assignedProfiles.length,
        assignedProfiles,
      };
    });

    return toolsWithProfiles;
  }

  /**
   * Get all tools for a specific catalog item with their assignment counts and assigned profiles
   * Used to show tools across all installations of the same catalog item
   */
  static async findByCatalogId(catalogId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      parameters: Record<string, unknown>;
      createdAt: Date;
      assignedProfileCount: number;
      assignedProfiles: Array<{ id: string; name: string }>;
    }>
  > {
    const tools = await db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        description: schema.toolsTable.description,
        parameters: schema.toolsTable.parameters,
        createdAt: schema.toolsTable.createdAt,
      })
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.catalogId, catalogId))
      .orderBy(desc(schema.toolsTable.createdAt));

    const toolIds = tools.map((tool) => tool.id);

    // Get all profile assignments for these tools in one query to avoid N+1
    const assignments = await db
      .select({
        toolId: schema.profileToolsTable.toolId,
        profileId: schema.profileToolsTable.profileId,
        profileName: schema.profilesTable.name,
      })
      .from(schema.profileToolsTable)
      .innerJoin(
        schema.profilesTable,
        eq(schema.profileToolsTable.profileId, schema.profilesTable.id),
      )
      .where(inArray(schema.profileToolsTable.toolId, toolIds));

    // Group assignments by tool ID
    const assignmentsByTool = new Map<
      string,
      Array<{ id: string; name: string }>
    >();

    for (const toolId of toolIds) {
      assignmentsByTool.set(toolId, []);
    }

    for (const assignment of assignments) {
      const toolAssignments = assignmentsByTool.get(assignment.toolId) || [];
      toolAssignments.push({
        id: assignment.profileId,
        name: assignment.profileName,
      });
      assignmentsByTool.set(assignment.toolId, toolAssignments);
    }

    // Build tools with their assigned profiles
    const toolsWithProfiles = tools.map((tool) => {
      const assignedProfiles = assignmentsByTool.get(tool.id) || [];

      return {
        ...tool,
        parameters: tool.parameters ?? {},
        assignedProfileCount: assignedProfiles.length,
        assignedProfiles,
      };
    });

    return toolsWithProfiles;
  }

  /**
   * Delete all tools for a specific catalog item
   * Used when the last MCP server installation for a catalog is removed
   * Returns the number of tools deleted
   */
  static async deleteByCatalogId(catalogId: string): Promise<number> {
    const result = await db
      .delete(schema.toolsTable)
      .where(eq(schema.toolsTable.catalogId, catalogId));

    return result.rowCount || 0;
  }

  /**
   * Delete a tool by ID.
   * Only allows deletion of auto-discovered tools (no mcpServerId).
   */
  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(schema.toolsTable)
      .where(
        and(
          eq(schema.toolsTable.id, id),
          isNull(schema.toolsTable.mcpServerId),
        ),
      );

    return (result.rowCount || 0) > 0;
  }

  static async getByIds(ids: string[]): Promise<Tool[]> {
    return db
      .select()
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.id, ids));
  }

  /**
   * Get tool names by IDs
   * Used to map tool IDs to names for filtering
   */
  static async getNamesByIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const tools = await db
      .select({ name: schema.toolsTable.name })
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.id, ids));

    return tools.map((t) => t.name);
  }

  /**
   * Bulk create proxy-sniffed tools for a profile (tools discovered via LLM proxy)
   * Fetches existing tools in a single query, then bulk inserts only new tools
   * Returns all tools (existing + newly created) to avoid N+1 queries
   */
  static async bulkCreateProxyToolsIfNotExists(
    tools: Array<{
      name: string;
      description?: string | null;
      parameters?: Record<string, unknown>;
    }>,
    profileId: string,
  ): Promise<Tool[]> {
    if (tools.length === 0) {
      return [];
    }

    const toolNames = tools.map((t) => t.name);

    // Fetch all existing tools for this profile in a single query
    const existingTools = await db
      .select()
      .from(schema.toolsTable)
      .where(
        and(
          eq(schema.toolsTable.profileId, profileId),
          isNull(schema.toolsTable.catalogId),
          inArray(schema.toolsTable.name, toolNames),
        ),
      );

    const existingToolsByName = new Map(existingTools.map((t) => [t.name, t]));

    // Prepare tools to insert (only those that don't exist)
    const toolsToInsert: InsertTool[] = [];
    const resultTools: Tool[] = [];

    for (const tool of tools) {
      const existingTool = existingToolsByName.get(tool.name);
      if (existingTool) {
        resultTools.push(existingTool);
      } else {
        toolsToInsert.push({
          name: tool.name,
          description: tool.description ?? null,
          parameters: tool.parameters ?? {},
          catalogId: null,
          mcpServerId: null,
          profileId,
        });
      }
    }

    // Bulk insert new tools if any
    if (toolsToInsert.length > 0) {
      const insertedTools = await db
        .insert(schema.toolsTable)
        .values(toolsToInsert)
        .onConflictDoNothing()
        .returning();

      // Create default policies for newly inserted tools
      for (const tool of insertedTools) {
        await ToolModel.createDefaultPolicies(tool.id);
      }

      // If some tools weren't inserted due to conflict, fetch them
      if (insertedTools.length < toolsToInsert.length) {
        const insertedNames = new Set(insertedTools.map((t) => t.name));
        const missingNames = toolsToInsert
          .filter((t) => !insertedNames.has(t.name))
          .map((t) => t.name);

        if (missingNames.length > 0) {
          const conflictTools = await db
            .select()
            .from(schema.toolsTable)
            .where(
              and(
                eq(schema.toolsTable.profileId, profileId),
                isNull(schema.toolsTable.catalogId),
                inArray(schema.toolsTable.name, missingNames),
              ),
            );
          resultTools.push(...insertedTools, ...conflictTools);
        } else {
          resultTools.push(...insertedTools);
        }
      } else {
        resultTools.push(...insertedTools);
      }
    }

    // Return tools in the same order as input
    const resultToolsByName = new Map(resultTools.map((t) => [t.name, t]));
    return tools
      .map((t) => resultToolsByName.get(t.name))
      .filter((t): t is Tool => t !== undefined);
  }

  /**
   * Create or get a profile delegation tool for a prompt agent
   * These tools are NOT assigned to profiles via profile_tools - they're prompt-specific
   * @param params.promptAgentId - The prompt_agents.id
   * @param params.profileName - The name of the delegated profile (used for tool name)
   * @param params.description - Description from the delegated prompt's systemPrompt
   */
  static async createProfileDelegationTool(params: {
    promptAgentId: string;
    profileName: string;
    description?: string | null;
  }): Promise<Tool> {
    const { promptAgentId, profileName, description } = params;

    // Check if tool already exists for this prompt agent
    const [existingTool] = await db
      .select()
      .from(schema.toolsTable)
      .where(eq(schema.toolsTable.promptAgentId, promptAgentId))
      .limit(1);

    if (existingTool) {
      return existingTool;
    }

    // Create the tool (NOT assigned to profile_tools - it's prompt-specific)
    const [tool] = await db
      .insert(schema.toolsTable)
      .values({
        name: `${AGENT_TOOL_PREFIX}${slugify(profileName)}`,
        promptAgentId,
        profileId: null,
        catalogId: null,
        mcpServerId: null,
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to send to this profile",
            },
          },
          required: ["message"],
        },
        description: description || `Delegate to ${profileName}`,
      })
      .returning();

    return tool;
  }

  /**
   * Get profile delegation tools for a prompt
   * Fetches tools that are linked to prompt_agents for the given promptId
   */
  static async getProfileDelegationToolsByPrompt(
    promptId: string,
  ): Promise<Tool[]> {
    // Get prompt_agents for this prompt
    const promptAgents = await db
      .select({ id: schema.promptAgentsTable.id })
      .from(schema.promptAgentsTable)
      .where(eq(schema.promptAgentsTable.promptId, promptId));

    if (promptAgents.length === 0) {
      return [];
    }

    const promptAgentIds = promptAgents.map((pa) => pa.id);

    // Get tools with promptAgentId in that list
    const tools = await db
      .select()
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.promptAgentId, promptAgentIds));

    return tools;
  }

  /**
   * Get profile delegation tools with profile info for user access filtering
   * Returns tools along with the profile ID of the delegated-to prompt
   */
  static async getProfileDelegationToolsWithDetails(promptId: string): Promise<
    Array<{
      tool: Tool;
      profileId: string;
      delegatePromptId: string;
      delegatePromptName: string;
      delegatePromptSystemPrompt: string | null;
    }>
  > {
    // Join tools with prompt_agents and prompts to get profile info
    const results = await db
      .select({
        tool: schema.toolsTable,
        profileId: schema.profilesTable.id,
        delegatePromptId: schema.promptAgentsTable.agentPromptId,
        delegatePromptName: schema.promptsTable.name,
        delegatePromptSystemPrompt: schema.promptsTable.systemPrompt,
      })
      .from(schema.toolsTable)
      .innerJoin(
        schema.promptAgentsTable,
        eq(schema.toolsTable.promptAgentId, schema.promptAgentsTable.id),
      )
      .innerJoin(
        schema.promptsTable,
        eq(schema.promptAgentsTable.agentPromptId, schema.promptsTable.id),
      )
      .innerJoin(
        schema.profilesTable,
        eq(schema.promptsTable.profileId, schema.profilesTable.id),
      )
      .where(eq(schema.promptAgentsTable.promptId, promptId));

    return results;
  }

  /**
   * Sync profile delegation tool names when a prompt is renamed
   * Updates the tool name for all tools that delegate to this prompt
   * @param delegatePromptIds - The prompt ID that was renamed (the delegated-to prompt)
   * @param newName - The new name of the prompt
   */
  static async syncProfileDelegationToolNames(
    delegatePromptIds: string | string[],
    newName: string,
  ): Promise<void> {
    const idsArray = Array.isArray(delegatePromptIds)
      ? delegatePromptIds
      : [delegatePromptIds];

    if (idsArray.length === 0) {
      return;
    }

    // Find all prompt_agents that point to any of these prompts (agentPromptId)
    const promptAgents = await db
      .select({ id: schema.promptAgentsTable.id })
      .from(schema.promptAgentsTable)
      .where(inArray(schema.promptAgentsTable.agentPromptId, idsArray));

    if (promptAgents.length === 0) {
      return;
    }

    const promptAgentIds = promptAgents.map((pa) => pa.id);
    const newToolName = `${AGENT_TOOL_PREFIX}${slugify(newName)}`;

    // Update all tools that reference these prompt_agents
    await db
      .update(schema.toolsTable)
      .set({ name: newToolName })
      .where(inArray(schema.toolsTable.promptAgentId, promptAgentIds));
  }

  /**
   * Find all tools with their profile assignments.
   * Returns one entry per tool (grouped by tool), with all assignments embedded.
   * Only returns tools that have at least one assignment.
   */
  static async findAllWithAssignments(params: {
    pagination?: { limit?: number; offset?: number };
    sorting?: {
      sortBy?: ToolSortBy;
      sortDirection?: ToolSortDirection;
    };
    filters?: ToolFilters;
    userId?: string;
    isAgentAdmin?: boolean;
  }): Promise<PaginatedResult<ToolWithAssignments>> {
    const {
      pagination = { limit: 20, offset: 0 },
      sorting,
      filters,
      userId,
      isAgentAdmin,
    } = params;

    // Build WHERE conditions for tools
    const toolWhereConditions: ReturnType<typeof sql>[] = [];

    // Filter by search query (tool name)
    if (filters?.search) {
      toolWhereConditions.push(
        ilike(schema.toolsTable.name, `%${filters.search}%`),
      );
    }

    // Filter by origin (either "llm-proxy" or a catalogId)
    if (filters?.origin) {
      if (filters.origin === "llm-proxy") {
        // LLM Proxy tools have null catalogId but profileId is set
        toolWhereConditions.push(isNull(schema.toolsTable.catalogId));
        toolWhereConditions.push(isNotNull(schema.toolsTable.profileId));
      } else {
        // MCP tools have a catalogId
        toolWhereConditions.push(
          eq(schema.toolsTable.catalogId, filters.origin),
        );
      }
    }

    // Exclude Archestra built-in tools
    if (filters?.excludeArchestraTools) {
      toolWhereConditions.push(
        notIlike(schema.toolsTable.name, "archestra__%"),
      );
    }

    // Apply access control filtering for users that are not agent admins
    // Get accessible profile IDs for filtering assignments
    let accessibleProfileIds: string[] | undefined;
    let accessibleMcpServerIds: Set<string> | undefined;
    if (userId && !isAgentAdmin) {
      const [profileIds, mcpServers] = await Promise.all([
        ProfileTeamModel.getUserAccessibleProfileIds(userId, false),
        McpServerModel.findAll(userId, false),
      ]);
      accessibleProfileIds = profileIds;
      accessibleMcpServerIds = new Set(mcpServers.map((s) => s.id));

      if (accessibleProfileIds.length === 0) {
        return createPaginatedResult([], 0, {
          limit: pagination.limit ?? 20,
          offset: pagination.offset ?? 0,
        });
      }
    }

    // Build the combined WHERE clause
    const toolWhereClause =
      toolWhereConditions.length > 0 ? and(...toolWhereConditions) : undefined;

    // Subquery to get tools that have at least one assignment (with access control)
    const assignmentConditions = accessibleProfileIds
      ? and(
          eq(schema.profileToolsTable.toolId, schema.toolsTable.id),
          inArray(schema.profileToolsTable.profileId, accessibleProfileIds),
        )
      : eq(schema.profileToolsTable.toolId, schema.toolsTable.id);

    // Count subquery for assignment count (with access control)
    const assignmentCountSubquery = sql<number>`(
      SELECT COUNT(*) FROM ${schema.profileToolsTable}
      WHERE ${assignmentConditions}
    )`;

    // Determine the ORDER BY clause based on sorting params
    const direction = sorting?.sortDirection === "asc" ? asc : desc;
    let orderByClause: ReturnType<typeof asc>;

    switch (sorting?.sortBy) {
      case "name":
        orderByClause = direction(schema.toolsTable.name);
        break;
      case "origin":
        // Sort by catalogId (null values for LLM Proxy)
        orderByClause = direction(
          sql`CASE WHEN ${schema.toolsTable.catalogId} IS NULL THEN '2-llm-proxy' ELSE '1-mcp' END`,
        );
        break;
      case "assignmentCount":
        orderByClause = direction(assignmentCountSubquery);
        break;
      default:
        orderByClause = direction(schema.toolsTable.createdAt);
        break;
    }

    // Query for tools that have at least one assignment
    const toolsWithCount = await db
      .select({
        id: schema.toolsTable.id,
        name: schema.toolsTable.name,
        description: schema.toolsTable.description,
        parameters: schema.toolsTable.parameters,
        catalogId: schema.toolsTable.catalogId,
        mcpServerId: schema.toolsTable.mcpServerId,
        mcpServerName: schema.mcpServersTable.name,
        mcpServerCatalogId: schema.mcpServersTable.catalogId,
        createdAt: schema.toolsTable.createdAt,
        updatedAt: schema.toolsTable.updatedAt,
        assignmentCount: assignmentCountSubquery,
      })
      .from(schema.toolsTable)
      .leftJoin(
        schema.mcpServersTable,
        eq(schema.toolsTable.mcpServerId, schema.mcpServersTable.id),
      )
      .where(
        and(
          toolWhereClause,
          // Only tools with at least one assignment
          sql`EXISTS (
            SELECT 1 FROM ${schema.profileToolsTable}
            WHERE ${assignmentConditions}
          )`,
        ),
      )
      .orderBy(orderByClause)
      .limit(pagination.limit ?? 20)
      .offset(pagination.offset ?? 0);

    // Get total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.toolsTable)
      .where(
        and(
          toolWhereClause,
          sql`EXISTS (
            SELECT 1 FROM ${schema.profileToolsTable}
            WHERE ${assignmentConditions}
          )`,
        ),
      );

    if (toolsWithCount.length === 0) {
      return createPaginatedResult([], 0, {
        limit: pagination.limit ?? 20,
        offset: pagination.offset ?? 0,
      });
    }

    // Get all assignments for these tools in one query
    const toolIds = toolsWithCount.map((t) => t.id as string);
    const assignmentWhereConditions = [
      inArray(schema.profileToolsTable.toolId, toolIds),
    ];

    // Apply access control to assignments
    if (accessibleProfileIds) {
      assignmentWhereConditions.push(
        inArray(schema.profileToolsTable.profileId, accessibleProfileIds),
      );
    }

    // Aliases for credential source and execution source MCP servers and their owners
    const credentialMcpServerAlias = alias(
      schema.mcpServersTable,
      "credentialMcpServer",
    );
    const credentialOwnerAlias = alias(schema.usersTable, "credentialOwner");
    const executionMcpServerAlias = alias(
      schema.mcpServersTable,
      "executionMcpServer",
    );
    const executionOwnerAlias = alias(schema.usersTable, "executionOwner");

    const assignments = await db
      .select({
        toolId: schema.profileToolsTable.toolId,
        profileToolId: schema.profileToolsTable.id,
        profileId: schema.profilesTable.id,
        profileName: schema.profilesTable.name,
        credentialSourceMcpServerId:
          schema.profileToolsTable.credentialSourceMcpServerId,
        credentialOwnerEmail: credentialOwnerAlias.email,
        executionSourceMcpServerId:
          schema.profileToolsTable.executionSourceMcpServerId,
        executionOwnerEmail: executionOwnerAlias.email,
        useDynamicTeamCredential:
          schema.profileToolsTable.useDynamicTeamCredential,
        responseModifierTemplate:
          schema.profileToolsTable.responseModifierTemplate,
      })
      .from(schema.profileToolsTable)
      .innerJoin(
        schema.profilesTable,
        eq(schema.profileToolsTable.profileId, schema.profilesTable.id),
      )
      .leftJoin(
        credentialMcpServerAlias,
        eq(
          schema.profileToolsTable.credentialSourceMcpServerId,
          credentialMcpServerAlias.id,
        ),
      )
      .leftJoin(
        credentialOwnerAlias,
        eq(credentialMcpServerAlias.ownerId, credentialOwnerAlias.id),
      )
      .leftJoin(
        executionMcpServerAlias,
        eq(
          schema.profileToolsTable.executionSourceMcpServerId,
          executionMcpServerAlias.id,
        ),
      )
      .leftJoin(
        executionOwnerAlias,
        eq(executionMcpServerAlias.ownerId, executionOwnerAlias.id),
      )
      .where(and(...assignmentWhereConditions));

    // Group assignments by tool ID
    const assignmentsByToolId = new Map<
      string,
      Array<{
        profileToolId: string;
        profile: { id: string; name: string };
        credentialSourceMcpServerId: string | null;
        credentialOwnerEmail: string | null;
        executionSourceMcpServerId: string | null;
        executionOwnerEmail: string | null;
        useDynamicTeamCredential: boolean;
        responseModifierTemplate: string | null;
      }>
    >();

    for (const assignment of assignments) {
      const existing = assignmentsByToolId.get(assignment.toolId) || [];

      // Check if user has access to the credential MCP server
      // If not accessible, don't include the owner email (frontend will show "Owner outside your team")
      const credentialServerAccessible =
        !accessibleMcpServerIds ||
        !assignment.credentialSourceMcpServerId ||
        accessibleMcpServerIds.has(assignment.credentialSourceMcpServerId);
      const executionServerAccessible =
        !accessibleMcpServerIds ||
        !assignment.executionSourceMcpServerId ||
        accessibleMcpServerIds.has(assignment.executionSourceMcpServerId);

      existing.push({
        profileToolId: assignment.profileToolId,
        profile: {
          id: assignment.profileId,
          name: assignment.profileName,
        },
        credentialSourceMcpServerId: assignment.credentialSourceMcpServerId,
        credentialOwnerEmail: credentialServerAccessible
          ? assignment.credentialOwnerEmail
          : null,
        executionSourceMcpServerId: assignment.executionSourceMcpServerId,
        executionOwnerEmail: executionServerAccessible
          ? assignment.executionOwnerEmail
          : null,
        useDynamicTeamCredential: assignment.useDynamicTeamCredential,
        responseModifierTemplate: assignment.responseModifierTemplate,
      });
      assignmentsByToolId.set(assignment.toolId, existing);
    }

    // Build the final result
    const result: ToolWithAssignments[] = toolsWithCount.map((tool) => ({
      id: tool.id as string,
      name: tool.name as string,
      description: tool.description as string | null,
      parameters: (tool.parameters as Record<string, unknown>) ?? {},
      catalogId: tool.catalogId as string | null,
      mcpServerId: tool.mcpServerId as string | null,
      mcpServerName: tool.mcpServerName as string | null,
      mcpServerCatalogId: tool.mcpServerCatalogId as string | null,
      createdAt: tool.createdAt as Date,
      updatedAt: tool.updatedAt as Date,
      assignmentCount: Number(tool.assignmentCount),
      assignments: assignmentsByToolId.get(tool.id as string) || [],
    }));

    return createPaginatedResult(result, Number(total), {
      limit: pagination.limit ?? 20,
      offset: pagination.offset ?? 0,
    });
  }
}

export default ToolModel;
