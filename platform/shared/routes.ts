export const RouteId = {
  // Profile Routes
  GetProfiles: "getProfiles",
  GetAllProfiles: "getAllProfiles",
  CreateProfile: "createProfile",
  GetProfile: "getProfile",
  GetDefaultProfile: "getDefaultProfile",
  UpdateProfile: "updateProfile",
  DeleteProfile: "deleteProfile",
  GetLabelKeys: "getLabelKeys",
  GetLabelValues: "getLabelValues",

  // Profile Tool Routes
  AssignToolToProfile: "assignToolToProfile",
  BulkAssignTools: "bulkAssignTools",
  BulkUpdateProfileTools: "bulkUpdateProfileTools",
  AutoConfigureProfileToolPolicies: "autoConfigureProfileToolPolicies",
  UnassignToolFromProfile: "unassignToolFromProfile",
  GetProfileTools: "getProfileTools",
  GetAllProfileTools: "getAllProfileTools",
  UpdateProfileTool: "updateProfileTool",
  GetProfileAvailableTokens: "getProfileAvailableTokens",

  // Features Routes
  GetFeatures: "getFeatures",

  // Auth Routes
  GetDefaultCredentialsStatus: "getDefaultCredentialsStatus",

  // MCP Catalog Routes
  GetInternalMcpCatalog: "getInternalMcpCatalog",
  CreateInternalMcpCatalogItem: "createInternalMcpCatalogItem",
  GetInternalMcpCatalogItem: "getInternalMcpCatalogItem",
  GetInternalMcpCatalogTools: "getInternalMcpCatalogTools",
  UpdateInternalMcpCatalogItem: "updateInternalMcpCatalogItem",
  DeleteInternalMcpCatalogItem: "deleteInternalMcpCatalogItem",
  DeleteInternalMcpCatalogItemByName: "deleteInternalMcpCatalogItemByName",

  // MCP Server Routes
  GetMcpServers: "getMcpServers",
  GetMcpServer: "getMcpServer",
  GetMcpServerTools: "getMcpServerTools",
  GetMcpServerLogs: "getMcpServerLogs",
  InstallMcpServer: "installMcpServer",
  DeleteMcpServer: "deleteMcpServer",
  RestartMcpServer: "restartMcpServer",
  RestartAllMcpServerInstallations: "restartAllMcpServerInstallations",
  GetMcpServerInstallationStatus: "getMcpServerInstallationStatus",
  McpProxy: "mcpProxy",

  // MCP Server Installation Request Routes
  GetMcpServerInstallationRequests: "getMcpServerInstallationRequests",
  CreateMcpServerInstallationRequest: "createMcpServerInstallationRequest",
  GetMcpServerInstallationRequest: "getMcpServerInstallationRequest",
  UpdateMcpServerInstallationRequest: "updateMcpServerInstallationRequest",
  ApproveMcpServerInstallationRequest: "approveMcpServerInstallationRequest",
  DeclineMcpServerInstallationRequest: "declineMcpServerInstallationRequest",
  AddMcpServerInstallationRequestNote: "addMcpServerInstallationRequestNote",
  DeleteMcpServerInstallationRequest: "deleteMcpServerInstallationRequest",

  // OAuth Routes
  InitiateOAuth: "initiateOAuth",
  HandleOAuthCallback: "handleOAuthCallback",

  // Team Routes
  GetTeams: "getTeams",
  CreateTeam: "createTeam",
  GetTeam: "getTeam",
  UpdateTeam: "updateTeam",
  DeleteTeam: "deleteTeam",
  GetTeamMembers: "getTeamMembers",
  AddTeamMember: "addTeamMember",
  RemoveTeamMember: "removeTeamMember",

  // Team External Group Routes (SSO Team Sync)
  GetTeamExternalGroups: "getTeamExternalGroups",
  AddTeamExternalGroup: "addTeamExternalGroup",
  RemoveTeamExternalGroup: "removeTeamExternalGroup",

  // Team Vault Folder Routes (BYOS - Bring Your Own Secrets)
  GetTeamVaultFolder: "getTeamVaultFolder",
  SetTeamVaultFolder: "setTeamVaultFolder",
  DeleteTeamVaultFolder: "deleteTeamVaultFolder",
  CheckTeamVaultFolderConnectivity: "checkTeamVaultFolderConnectivity",
  ListTeamVaultFolderSecrets: "listTeamVaultFolderSecrets",
  GetTeamVaultSecretKeys: "getTeamVaultSecretKeys",

  // Role Routes
  GetRoles: "getRoles",
  CreateRole: "createRole",
  GetRole: "getRole",
  UpdateRole: "updateRole",
  DeleteRole: "deleteRole",

  // Tool Routes
  GetTools: "getTools",
  GetToolsWithAssignments: "getToolsWithAssignments",
  GetUnassignedTools: "getUnassignedTools",
  DeleteTool: "deleteTool",

  // Interaction Routes
  GetInteractions: "getInteractions",
  GetInteraction: "getInteraction",
  GetInteractionSessions: "getInteractionSessions",
  GetUniqueExternalAgentIds: "getUniqueExternalAgentIds",
  GetUniqueUserIds: "getUniqueUserIds",

  // MCP Tool Call Routes
  GetMcpToolCalls: "getMcpToolCalls",
  GetMcpToolCall: "getMcpToolCall",

  // Autonomy Policy Routes
  GetOperators: "getOperators",
  GetToolInvocationPolicies: "getToolInvocationPolicies",
  CreateToolInvocationPolicy: "createToolInvocationPolicy",
  GetToolInvocationPolicy: "getToolInvocationPolicy",
  UpdateToolInvocationPolicy: "updateToolInvocationPolicy",
  DeleteToolInvocationPolicy: "deleteToolInvocationPolicy",
  GetTrustedDataPolicies: "getTrustedDataPolicies",
  CreateTrustedDataPolicy: "createTrustedDataPolicy",
  GetTrustedDataPolicy: "getTrustedDataPolicy",
  UpdateTrustedDataPolicy: "updateTrustedDataPolicy",
  DeleteTrustedDataPolicy: "deleteTrustedDataPolicy",
  BulkUpsertDefaultCallPolicy: "bulkUpsertDefaultCallPolicy",
  BulkUpsertDefaultResultPolicy: "bulkUpsertDefaultResultPolicy",
  GetPolicyConfigSubagentPrompt: "getPolicyConfigSubagentPrompt",

  // Dual LLM Config Routes
  GetDefaultDualLlmConfig: "getDefaultDualLlmConfig",
  GetDualLlmConfigs: "getDualLlmConfigs",
  CreateDualLlmConfig: "createDualLlmConfig",
  GetDualLlmConfig: "getDualLlmConfig",
  UpdateDualLlmConfig: "updateDualLlmConfig",
  DeleteDualLlmConfig: "deleteDualLlmConfig",

  // Dual LLM Result Routes
  GetDualLlmResultByToolCallId: "getDualLlmResultByToolCallId",
  GetDualLlmResultsByInteraction: "getDualLlmResultsByInteraction",

  // Proxy Routes - OpenAI
  OpenAiChatCompletionsWithDefaultProfile:
    "openAiChatCompletionsWithDefaultProfile",
  OpenAiChatCompletionsWithProfile: "openAiChatCompletionsWithProfile",

  // Proxy Routes - Anthropic
  AnthropicMessagesWithDefaultProfile: "anthropicMessagesWithDefaultProfile",
  AnthropicMessagesWithProfile: "anthropicMessagesWithProfile",

  // Proxy Routes - Cerebras
  CerebrasChatCompletionsWithDefaultProfile:
    "cerebrasChatCompletionsWithDefaultProfile",
  CerebrasChatCompletionsWithProfile: "cerebrasChatCompletionsWithProfile",

  // Proxy Routes - vLLM
  VllmChatCompletionsWithDefaultProfile:
    "vllmChatCompletionsWithDefaultProfile",
  VllmChatCompletionsWithProfile: "vllmChatCompletionsWithProfile",

  // Proxy Routes - Ollama
  OllamaChatCompletionsWithDefaultProfile:
    "ollamaChatCompletionsWithDefaultProfile",
  OllamaChatCompletionsWithProfile: "ollamaChatCompletionsWithProfile",
  // Proxy Routes - Zhipu AI
  ZhipuaiChatCompletionsWithDefaultProfile:
    "zhipuaiChatCompletionsWithDefaultProfile",
  ZhipuaiChatCompletionsWithProfile: "zhipuaiChatCompletionsWithProfile",

  // Chat Routes
  StreamChat: "streamChat",
  GetChatConversations: "getChatConversations",
  GetChatConversation: "getChatConversation",
  GetChatProfileMcpTools: "getChatProfileMcpTools",
  CreateChatConversation: "createChatConversation",
  UpdateChatConversation: "updateChatConversation",
  DeleteChatConversation: "deleteChatConversation",
  GenerateChatConversationTitle: "generateChatConversationTitle",
  GetChatMcpTools: "getChatMcpTools",
  UpdateChatMessage: "updateChatMessage",
  GetConversationEnabledTools: "getConversationEnabledTools",
  UpdateConversationEnabledTools: "updateConversationEnabledTools",
  DeleteConversationEnabledTools: "deleteConversationEnabledTools",
  GetChatModels: "getChatModels",

  // Chat API Key Routes
  GetChatApiKeys: "getChatApiKeys",
  GetAvailableChatApiKeys: "getAvailableChatApiKeys",
  CreateChatApiKey: "createChatApiKey",
  GetChatApiKey: "getChatApiKey",
  UpdateChatApiKey: "updateChatApiKey",
  DeleteChatApiKey: "deleteChatApiKey",

  // Prompt Routes
  GetPrompts: "getPrompts",
  CreatePrompt: "createPrompt",
  GetPrompt: "getPrompt",
  GetPromptVersions: "getPromptVersions",
  GetPromptTools: "getPromptTools",
  RollbackPrompt: "rollbackPrompt",
  UpdatePrompt: "updatePrompt",
  DeletePrompt: "deletePrompt",

  // Profile Prompt Routes
  GetProfilePrompts: "getProfilePrompts",
  AssignProfilePrompts: "assignProfilePrompts",
  DeleteProfilePrompt: "deleteProfilePrompt",

  // Prompt Profile Routes (profile assignment to prompts)
  GetAllPromptProfileConnections: "getAllPromptProfileConnections",
  GetPromptProfiles: "getPromptProfiles",
  SyncPromptProfiles: "syncPromptProfiles",
  DeletePromptProfile: "deletePromptProfile",

  // Limits Routes
  GetLimits: "getLimits",
  CreateLimit: "createLimit",
  GetLimit: "getLimit",
  UpdateLimit: "updateLimit",
  DeleteLimit: "deleteLimit",

  // Organization Routes
  GetOrganization: "getOrganization",
  UpdateOrganization: "updateOrganization",
  GetOnboardingStatus: "getOnboardingStatus",

  // Appearance Routes (public/unauthenticated)
  GetPublicAppearance: "getPublicAppearance",

  // SSO Provider Routes
  GetPublicSsoProviders: "getPublicSsoProviders",
  GetSsoProviders: "getSsoProviders",
  GetSsoProvider: "getSsoProvider",
  CreateSsoProvider: "createSsoProvider",
  UpdateSsoProvider: "updateSsoProvider",
  DeleteSsoProvider: "deleteSsoProvider",

  // User Routes
  GetUserPermissions: "getUserPermissions",

  // Token Price Routes
  GetTokenPrices: "getTokenPrices",
  CreateTokenPrice: "createTokenPrice",
  GetTokenPrice: "getTokenPrice",
  UpdateTokenPrice: "updateTokenPrice",
  DeleteTokenPrice: "deleteTokenPrice",

  // Team Token Routes
  GetTokens: "getTokens",
  GetTokenValue: "getTokenValue",
  RotateToken: "rotateToken",

  // User Token Routes (Personal Tokens)
  GetUserToken: "getUserToken",
  GetUserTokenValue: "getUserTokenValue",
  RotateUserToken: "rotateUserToken",

  // Statistics Routes
  GetTeamStatistics: "getTeamStatistics",
  GetProfileStatistics: "getProfileStatistics",
  GetModelStatistics: "getModelStatistics",
  GetOverviewStatistics: "getOverviewStatistics",
  GetCostSavingsStatistics: "getCostSavingsStatistics",

  // Optimization Rule Routes
  GetOptimizationRules: "getOptimizationRules",
  CreateOptimizationRule: "createOptimizationRule",
  UpdateOptimizationRule: "updateOptimizationRule",
  DeleteOptimizationRule: "deleteOptimizationRule",

  // Secrets Routes
  GetSecretsType: "getSecretsType",
  GetSecret: "getSecret",
  CheckSecretsConnectivity: "checkSecretsConnectivity",
  InitializeSecretsManager: "initializeSecretsManager",

  // Incoming Email Routes
  GetIncomingEmailStatus: "getIncomingEmailStatus",
  SetupIncomingEmailWebhook: "setupIncomingEmailWebhook",
  RenewIncomingEmailSubscription: "renewIncomingEmailSubscription",
  DeleteIncomingEmailSubscription: "deleteIncomingEmailSubscription",
  GetPromptEmailAddress: "getPromptEmailAddress",

  // ChatOps Routes
  GetChatOpsStatus: "getChatOpsStatus",
  ListChatOpsBindings: "listChatOpsBindings",
  DeleteChatOpsBinding: "deleteChatOpsBinding",
} as const;

export type RouteId = (typeof RouteId)[keyof typeof RouteId];
