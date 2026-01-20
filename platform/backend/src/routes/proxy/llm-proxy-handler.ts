/**
 * Generic LLM Proxy Handler
 *
 * A reusable handler that works with any LLM provider through the adapter pattern.
 * Routes choose which adapter factory to use based on URL.
 */

import type { FastifyReply } from "fastify";
import config from "@/config";
import getDefaultPricing from "@/default-model-prices";
import {
  reportBlockedTools,
  reportLLMCost,
  reportLLMTokens,
  reportTimeToFirstToken,
  reportTokensPerSecond,
} from "@/llm-metrics";
import logger from "@/logging";
import {
  InteractionModel,
  LimitValidationService,
  ProfileModel,
  ProfileTeamModel,
  TokenPriceModel,
} from "@/models";
import {
  ApiError,
  type InteractionRequest,
  type InteractionResponse,
  type LLMProvider,
  type LLMStreamAdapter,
  type Profile,
  type ToonCompressionResult,
} from "@/types";
import * as utils from "./utils";
import type { SessionSource } from "./utils/session-id";

export interface Context {
  organizationId: string;
  profileId?: string;
  externalAgentId?: string;
  userId?: string;
  sessionId?: string | null;
  sessionSource?: SessionSource;
}

function getProviderMessagesCount(messages: unknown): number | null {
  if (Array.isArray(messages)) {
    return messages.length;
  }

  if (messages && typeof messages === "object") {
    const candidate = messages as Record<string, unknown>;
    if (Array.isArray(candidate.messages)) {
      return candidate.messages.length;
    }
  }

  return null;
}

/**
 * Generic LLM proxy handler that works with any provider through adapters
 */
export async function handleLLMProxy<
  TRequest,
  TResponse,
  TMessages,
  TChunk,
  THeaders,
>(
  body: TRequest,
  headers: THeaders,
  reply: FastifyReply,
  provider: LLMProvider<TRequest, TResponse, TMessages, TChunk, THeaders>,
  context: Context,
): Promise<FastifyReply> {
  const { profileId, externalAgentId } = context;
  const providerName = provider.provider;

  // Extract session info if not already provided in context
  const sessionInfo =
    context.sessionId !== undefined
      ? { sessionId: context.sessionId, sessionSource: context.sessionSource }
      : utils.sessionId.extractSessionInfo(
          headers as Record<string, string | string[] | undefined>,
          body as
            | {
                metadata?: { user_id?: string | null };
                user?: string | null;
              }
            | undefined,
        );
  const { sessionId, sessionSource } = sessionInfo;

  const requestAdapter = provider.createRequestAdapter(body);
  const streamAdapter = provider.createStreamAdapter();
  const providerMessages = requestAdapter.getProviderMessages();
  const messagesCount = getProviderMessagesCount(providerMessages);

  logger.debug(
    {
      profileId,
      model: requestAdapter.getModel(),
      stream: requestAdapter.isStreaming(),
      messagesCount,
      toolsCount: requestAdapter.getTools().length,
    },
    `[${providerName}Proxy] handleLLMProxy: request received`,
  );

  // Resolve profile
  let resolvedProfile: Profile;
  if (profileId) {
    logger.debug(
      { profileId },
      `[${providerName}Proxy] Resolving explicit profile by ID`,
    );
    const profile = await ProfileModel.findById(profileId);
    if (!profile) {
      logger.debug({ profileId }, `[${providerName}Proxy] Profile not found`);
      return reply.status(404).send({
        error: {
          message: `Profile with ID ${profileId} not found`,
          type: "not_found",
        },
      });
    }
    resolvedProfile = profile;
  } else {
    logger.debug(
      { userAgent: (headers as Record<string, unknown>)["user-agent"] },
      `[${providerName}Proxy] Resolving default profile by user-agent`,
    );
    resolvedProfile = await ProfileModel.getProfileOrCreateDefault(
      (headers as Record<string, unknown>)["user-agent"] as string | undefined,
    );
  }

  const resolvedProfileId = resolvedProfile.id;
  logger.debug(
    {
      resolvedProfileId,
      profileName: resolvedProfile.name,
      wasExplicit: !!profileId,
    },
    `[${providerName}Proxy] Profile resolved`,
  );

  // Extract API key
  const apiKey = provider.extractApiKey(headers);

  // Check usage limits
  try {
    logger.debug(
      { resolvedProfileId },
      `[${providerName}Proxy] Checking usage limits`,
    );
    const limitViolation =
      await LimitValidationService.checkLimitsBeforeRequest(resolvedProfileId);

    if (limitViolation) {
      const [_refusalMessage, contentMessage] = limitViolation;
      logger.info(
        { resolvedProfileId, reason: "token_cost_limit_exceeded" },
        `${providerName} request blocked due to token cost limit`,
      );
      return reply.status(429).send({
        error: {
          message: contentMessage,
          type: "rate_limit_exceeded",
          code: "token_cost_limit_exceeded",
        },
      });
    }
    logger.debug(
      { resolvedProfileId },
      `[${providerName}Proxy] Limit check passed`,
    );

    // Persist tools declared by client
    const tools = requestAdapter.getTools();
    if (tools.length > 0) {
      logger.debug(
        { toolCount: tools.length },
        `[${providerName}Proxy] Processing tools from request`,
      );
      await utils.tools.persistTools(
        tools.map((t) => ({
          toolName: t.name,
          toolParameters: t.inputSchema,
          toolDescription: t.description,
        })),
        resolvedProfileId,
      );
    }

    // Cost optimization - potentially switch to cheaper model
    const baselineModel = requestAdapter.getModel();
    const hasTools = requestAdapter.hasTools();
    // Cast messages since getOptimizedModel expects specific provider types
    // but our generic adapter provides the correct type at runtime
    const optimizedModel = await utils.costOptimization.getOptimizedModel(
      resolvedProfile,
      requestAdapter.getProviderMessages() as Parameters<
        typeof utils.costOptimization.getOptimizedModel
      >[1],
      providerName as Parameters<
        typeof utils.costOptimization.getOptimizedModel
      >[2],
      hasTools,
    );

    if (optimizedModel) {
      requestAdapter.setModel(optimizedModel);
      logger.info(
        { resolvedProfileId, optimizedModel },
        "Optimized model selected",
      );
    } else {
      logger.info(
        { resolvedProfileId, baselineModel },
        "No matching optimized model found, proceeding with baseline model",
      );
    }

    const actualModel = requestAdapter.getModel();

    // Ensure token prices exist
    const baselinePricing = getDefaultPricing(baselineModel);
    await TokenPriceModel.createIfNotExists(baselineModel, {
      provider: providerName,
      ...baselinePricing,
    });

    if (actualModel !== baselineModel) {
      const optimizedPricing = getDefaultPricing(actualModel);
      await TokenPriceModel.createIfNotExists(actualModel, {
        provider: providerName,
        ...optimizedPricing,
      });
    }

    // Set SSE headers early if streaming
    if (requestAdapter.isStreaming()) {
      logger.debug(
        `[${providerName}Proxy] Setting up streaming response headers`,
      );
      const sseHeaders = streamAdapter.getSSEHeaders();
      for (const [key, value] of Object.entries(sseHeaders)) {
        reply.header(key, value);
      }
    }

    // Get global tool policy from organization (with fallback) - needed for both trusted data and tool invocation
    const globalToolPolicy =
      await utils.toolInvocation.getGlobalToolPolicy(resolvedProfileId);

    // Fetch team IDs for policy evaluation context (needed for trusted data evaluation)
    const teamIds =
      await ProfileTeamModel.getTeamsForProfile(resolvedProfileId);

    // Evaluate trusted data policies
    logger.debug(
      {
        resolvedProfileId,
        considerContextUntrusted: resolvedProfile.considerContextUntrusted,
        globalToolPolicy,
      },
      `[${providerName}Proxy] Evaluating trusted data policies`,
    );

    const commonMessages = requestAdapter.getMessages();
    const { toolResultUpdates, contextIsTrusted } =
      await utils.trustedData.evaluateIfContextIsTrusted(
        commonMessages,
        resolvedProfileId,
        apiKey,
        providerName,
        resolvedProfile.considerContextUntrusted,
        globalToolPolicy,
        { teamIds, externalAgentId },
        // Streaming callbacks for dual LLM progress
        requestAdapter.isStreaming()
          ? () => {
              reply.raw.write(
                streamAdapter.formatTextDeltaSSE(
                  "Analyzing with Dual LLM:\n\n",
                ),
              );
            }
          : undefined,
        requestAdapter.isStreaming()
          ? (progress: {
              question: string;
              options: string[];
              answer: string;
            }) => {
              const optionsText = progress.options
                .map((opt: string, idx: number) => `  ${idx}: ${opt}`)
                .join("\n");
              reply.raw.write(
                streamAdapter.formatTextDeltaSSE(
                  `Question: ${progress.question}\nOptions:\n${optionsText}\nAnswer: ${progress.answer}\n\n`,
                ),
              );
            }
          : undefined,
      );

    // Apply tool result updates
    requestAdapter.applyToolResultUpdates(toolResultUpdates);

    logger.info(
      {
        resolvedProfileId,
        toolResultUpdatesCount: Object.keys(toolResultUpdates).length,
        contextIsTrusted,
      },
      "Messages filtered after trusted data evaluation",
    );

    // Apply TOON compression if enabled
    let toonStats: ToonCompressionResult = {
      tokensBefore: null,
      tokensAfter: null,
      costSavings: null,
    };

    const shouldApplyToonCompression =
      await utils.toonConversion.shouldApplyToonCompression(resolvedProfileId);

    if (shouldApplyToonCompression) {
      toonStats = await requestAdapter.applyToonCompression(actualModel);
    }

    logger.info(
      {
        shouldApplyToonCompression,
        toonTokensBefore: toonStats.tokensBefore,
        toonTokensAfter: toonStats.tokensAfter,
        toonCostSavings: toonStats.costSavings,
      },
      `${providerName} proxy: tool results compression completed`,
    );

    // Extract provider-specific headers to forward (e.g., anthropic-beta)
    // Type cast is necessary because this is a generic handler for multiple providers,
    // and only Anthropic has the anthropic-beta header in its type definition
    const headersToForward: Record<string, string> = {};
    const headersObj = headers as Record<string, unknown>;
    if (typeof headersObj["anthropic-beta"] === "string") {
      headersToForward["anthropic-beta"] = headersObj["anthropic-beta"];
    }

    // Create client with observability (each provider handles metrics internally)
    const client = provider.createClient(apiKey, {
      baseUrl: provider.getBaseUrl(),
      mockMode: config.benchmark.mockMode,
      profile: resolvedProfile,
      externalAgentId,
      defaultHeaders:
        Object.keys(headersToForward).length > 0 ? headersToForward : undefined,
    });

    // Build final request
    const finalRequest = requestAdapter.toProviderRequest();

    // Extract enabled tool names for filtering in evaluatePolicies
    const enabledToolNames = new Set(tools.map((t) => t.name).filter(Boolean));

    // Convert headers to Record<string, string> for policy evaluation context
    const headersRecord: Record<string, string> = {};
    const rawHeaders = headers as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value === "string") {
        headersRecord[key] = value;
      }
    }

    if (requestAdapter.isStreaming()) {
      return handleStreaming(
        client,
        finalRequest,
        reply,
        provider,
        streamAdapter,
        resolvedProfile,
        contextIsTrusted,
        baselineModel,
        actualModel,
        requestAdapter.getOriginalRequest(),
        toonStats,
        enabledToolNames,
        globalToolPolicy,
        externalAgentId,
        context.userId,
        sessionId,
        sessionSource,
        teamIds,
      );
    } else {
      return handleNonStreaming(
        client,
        finalRequest,
        reply,
        provider,
        resolvedProfile,
        contextIsTrusted,
        baselineModel,
        actualModel,
        requestAdapter.getOriginalRequest(),
        toonStats,
        enabledToolNames,
        globalToolPolicy,
        externalAgentId,
        context.userId,
        sessionId,
        sessionSource,
        teamIds,
      );
    }
  } catch (error) {
    return handleError(
      error,
      reply,
      provider.extractErrorMessage,
      requestAdapter.isStreaming(),
    );
  }
}

// =============================================================================
// STREAMING HANDLER
// =============================================================================

async function handleStreaming<
  TRequest,
  TResponse,
  TMessages,
  TChunk,
  THeaders,
>(
  client: unknown,
  request: TRequest,
  reply: FastifyReply,
  provider: LLMProvider<TRequest, TResponse, TMessages, TChunk, THeaders>,
  streamAdapter: LLMStreamAdapter<TChunk, TResponse>,
  profile: Profile,
  contextIsTrusted: boolean,
  baselineModel: string,
  actualModel: string,
  originalRequest: TRequest,
  toonStats: ToonCompressionResult,
  enabledToolNames: Set<string>,
  globalToolPolicy: "permissive" | "restrictive",
  externalAgentId?: string,
  userId?: string,
  sessionId?: string | null,
  sessionSource?: SessionSource,
  teamIds?: string[],
): Promise<FastifyReply> {
  const providerName = provider.provider;
  const streamStartTime = Date.now();
  let firstChunkTime: number | undefined;
  let streamCompleted = false;

  logger.debug(
    { model: actualModel },
    `[${providerName}Proxy] Starting streaming request`,
  );

  try {
    // Execute streaming request with tracing
    const stream = await utils.tracing.startActiveLlmSpan(
      provider.getSpanName(true),
      providerName,
      actualModel,
      true,
      profile,
      async (llmSpan) => {
        const result = await provider.executeStream(client, request);
        llmSpan.end();
        return result;
      },
    );

    // Process chunks
    for await (const chunk of stream) {
      // Track first chunk time
      if (!firstChunkTime) {
        firstChunkTime = Date.now();
        const ttftSeconds = (firstChunkTime - streamStartTime) / 1000;
        reportTimeToFirstToken(
          providerName,
          profile,
          actualModel,
          ttftSeconds,
          externalAgentId,
        );
      }

      const result = streamAdapter.processChunk(chunk);

      // Stream non-tool-call data immediately
      if (result.sseData) {
        reply.raw.write(result.sseData);
      }

      if (result.isFinal) {
        break;
      }
    }

    logger.info("Stream loop completed, processing final events");

    // Evaluate tool invocation policies
    const toolCalls = streamAdapter.state.toolCalls;
    let toolInvocationRefusal: [string, string] | null = null;

    if (toolCalls.length > 0) {
      logger.info(
        {
          toolCallCount: toolCalls.length,
          toolNames: toolCalls.map((tc) => tc.name),
        },
        "Evaluating tool invocation policies",
      );

      // Parse tool arguments for policy evaluation
      const toolCallsForPolicy = toolCalls.map((tc) => {
        let argsString = tc.arguments;
        try {
          // Verify it's valid JSON
          JSON.parse(tc.arguments);
        } catch {
          // If not valid JSON, wrap it
          argsString = JSON.stringify({ raw: tc.arguments });
        }
        return {
          toolCallName: tc.name,
          toolCallArgs: argsString,
        };
      });

      toolInvocationRefusal = await utils.toolInvocation.evaluatePolicies(
        toolCallsForPolicy,
        profile.id,
        {
          teamIds: teamIds ?? [],
          externalAgentId,
        },
        contextIsTrusted,
        enabledToolNames,
        globalToolPolicy,
      );

      logger.info(
        { refused: !!toolInvocationRefusal },
        "Tool invocation policy result",
      );
    }

    if (toolInvocationRefusal) {
      const [_refusalMessage, contentMessage] = toolInvocationRefusal;

      // Stream refusal
      const refusalEvents = streamAdapter.formatCompleteTextSSE(contentMessage);
      for (const event of refusalEvents) {
        reply.raw.write(event);
      }

      reportBlockedTools(
        providerName,
        profile,
        toolCalls.length,
        actualModel,
        externalAgentId,
      );
    } else if (toolCalls.length > 0) {
      // Tool calls approved - stream raw events
      logger.info(
        { toolCallCount: toolCalls.length },
        "Tool calls allowed, streaming them now",
      );

      const rawEvents = streamAdapter.getRawToolCallEvents();
      for (const event of rawEvents) {
        reply.raw.write(event);
      }
    }

    // Stream end events
    reply.raw.write(streamAdapter.formatEndSSE());
    reply.raw.end();

    streamCompleted = true;
    return reply;
  } catch (error) {
    return handleError(error, reply, provider.extractErrorMessage, true);
  } finally {
    // Always record interaction (whether stream completed or was aborted)
    if (!streamCompleted) {
      logger.info(
        "Stream was aborted before completion, recording partial interaction",
      );
    }

    const usage = streamAdapter.state.usage;
    if (usage) {
      reportLLMTokens(
        providerName,
        profile,
        { input: usage.inputTokens, output: usage.outputTokens },
        actualModel,
        externalAgentId,
      );

      if (usage.outputTokens && firstChunkTime) {
        const totalDurationSeconds = (Date.now() - streamStartTime) / 1000;
        reportTokensPerSecond(
          providerName,
          profile,
          actualModel,
          usage.outputTokens,
          totalDurationSeconds,
          externalAgentId,
        );
      }

      const baselineCost = await utils.costOptimization.calculateCost(
        baselineModel,
        usage.inputTokens,
        usage.outputTokens,
      );
      const actualCost = await utils.costOptimization.calculateCost(
        actualModel,
        usage.inputTokens,
        usage.outputTokens,
      );

      reportLLMCost(
        providerName,
        profile,
        actualModel,
        actualCost,
        externalAgentId,
      );

      await InteractionModel.create({
        profileId: profile.id,
        externalAgentId,
        userId,
        sessionId,
        sessionSource,
        type: provider.interactionType,
        // Cast generic types to interaction types - valid at runtime
        request: originalRequest as unknown as InteractionRequest,
        processedRequest: request as unknown as InteractionRequest,
        response:
          streamAdapter.toProviderResponse() as unknown as InteractionResponse,
        model: actualModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: actualCost?.toFixed(10) ?? null,
        baselineCost: baselineCost?.toFixed(10) ?? null,
        toonTokensBefore: toonStats.tokensBefore,
        toonTokensAfter: toonStats.tokensAfter,
        toonCostSavings: toonStats.costSavings?.toFixed(10) ?? null,
      });
    }
  }
}

// =============================================================================
// NON-STREAMING HANDLER
// =============================================================================

async function handleNonStreaming<
  TRequest,
  TResponse,
  TMessages,
  TChunk,
  THeaders,
>(
  client: unknown,
  request: TRequest,
  reply: FastifyReply,
  provider: LLMProvider<TRequest, TResponse, TMessages, TChunk, THeaders>,
  profile: Profile,
  contextIsTrusted: boolean,
  baselineModel: string,
  actualModel: string,
  originalRequest: TRequest,
  toonStats: ToonCompressionResult,
  enabledToolNames: Set<string>,
  globalToolPolicy: "permissive" | "restrictive",
  externalAgentId?: string,
  userId?: string,
  sessionId?: string | null,
  sessionSource?: SessionSource,
  teamIds?: string[],
): Promise<FastifyReply> {
  const providerName = provider.provider;

  logger.debug(
    { model: actualModel },
    `[${providerName}ProxyV2] Starting non-streaming request`,
  );

  // Execute request with tracing
  const response = await utils.tracing.startActiveLlmSpan(
    provider.getSpanName(false),
    providerName,
    actualModel,
    false,
    profile,
    async (llmSpan: { end: () => void }) => {
      const result = await provider.execute(client, request);
      llmSpan.end();
      return result;
    },
  );

  // Create response adapter
  const responseAdapter = provider.createResponseAdapter(response);

  const toolCalls = responseAdapter.getToolCalls();
  logger.debug(
    { toolCallCount: toolCalls.length },
    `[${providerName}Proxy] Non-streaming response received, checking tool invocation policies`,
  );

  // Evaluate tool invocation policies
  if (toolCalls.length > 0) {
    const toolInvocationRefusal = await utils.toolInvocation.evaluatePolicies(
      toolCalls.map((tc) => ({
        toolCallName: tc.name,
        toolCallArgs:
          typeof tc.arguments === "string"
            ? tc.arguments
            : JSON.stringify(tc.arguments),
      })),
      profile.id,
      {
        teamIds: teamIds ?? [],
        externalAgentId,
      },
      contextIsTrusted,
      enabledToolNames,
      globalToolPolicy,
    );

    if (toolInvocationRefusal) {
      const [refusalMessage, contentMessage] = toolInvocationRefusal;
      logger.debug(
        { toolCallCount: toolCalls.length },
        `[${providerName}Proxy] Tool invocation blocked by policy`,
      );

      const refusalResponse = responseAdapter.toRefusalResponse(
        refusalMessage,
        contentMessage,
      );

      reportBlockedTools(
        providerName,
        profile,
        toolCalls.length,
        actualModel,
        externalAgentId,
      );

      // Record interaction with refusal
      const usage = responseAdapter.getUsage();
      const baselineCost = await utils.costOptimization.calculateCost(
        baselineModel,
        usage.inputTokens,
        usage.outputTokens,
      );
      const actualCost = await utils.costOptimization.calculateCost(
        actualModel,
        usage.inputTokens,
        usage.outputTokens,
      );

      reportLLMCost(
        providerName,
        profile,
        actualModel,
        actualCost,
        externalAgentId,
      );

      await InteractionModel.create({
        profileId: profile.id,
        externalAgentId,
        userId,
        sessionId,
        sessionSource,
        type: provider.interactionType,
        // Cast generic types to interaction types - valid at runtime
        request: originalRequest as unknown as InteractionRequest,
        processedRequest: request as unknown as InteractionRequest,
        response: refusalResponse as unknown as InteractionResponse,
        model: actualModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: actualCost?.toFixed(10) ?? null,
        baselineCost: baselineCost?.toFixed(10) ?? null,
        toonTokensBefore: toonStats.tokensBefore,
        toonTokensAfter: toonStats.tokensAfter,
        toonCostSavings: toonStats.costSavings?.toFixed(10) ?? null,
      });

      return reply.send(refusalResponse);
    }
  }

  // Tool calls allowed (or no tool calls) - return response
  const usage = responseAdapter.getUsage();

  // Note: Token metrics are reported by getObservableFetch() in the HTTP layer
  // for non-streaming requests. We only report cost here to avoid double counting.
  // TODO: Add test for metrics reported by the LLM proxy. It's not obvious since
  // mocked API clients can't use an observable fetch.
  // reportLLMTokens(
  //   providerName,
  //   profile,
  //   { input: usage.inputTokens, output: usage.outputTokens },
  //   actualModel,
  //   externalAgentId,
  // );

  const baselineCost = await utils.costOptimization.calculateCost(
    baselineModel,
    usage.inputTokens,
    usage.outputTokens,
  );
  const actualCost = await utils.costOptimization.calculateCost(
    actualModel,
    usage.inputTokens,
    usage.outputTokens,
  );

  reportLLMCost(
    providerName,
    profile,
    actualModel,
    actualCost,
    externalAgentId,
  );

  await InteractionModel.create({
    profileId: profile.id,
    externalAgentId,
    userId,
    sessionId,
    sessionSource,
    type: provider.interactionType,
    // Cast generic types to interaction types - valid at runtime
    request: originalRequest as unknown as InteractionRequest,
    processedRequest: request as unknown as InteractionRequest,
    response:
      responseAdapter.getOriginalResponse() as unknown as InteractionResponse,
    model: actualModel,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: actualCost?.toFixed(10) ?? null,
    baselineCost: baselineCost?.toFixed(10) ?? null,
    toonTokensBefore: toonStats.tokensBefore,
    toonTokensAfter: toonStats.tokensAfter,
    toonCostSavings: toonStats.costSavings?.toFixed(10) ?? null,
  });

  return reply.send(responseAdapter.getOriginalResponse());
}

// =============================================================================
// HELPERS
// =============================================================================

function handleError(
  error: unknown,
  reply: FastifyReply,
  extractErrorMessage: (error: unknown) => string,
  isStreaming: boolean,
): FastifyReply | never {
  logger.error(error);

  // Extract status code from error, checking multiple common property names
  // and ensuring the value is a valid number (not undefined/null)
  let statusCode: number = 500;
  if (error instanceof Error) {
    const errorObj = error as Error & {
      status?: number;
      statusCode?: number;
    };
    if (typeof errorObj.status === "number") {
      statusCode = errorObj.status;
    } else if (typeof errorObj.statusCode === "number") {
      statusCode = errorObj.statusCode;
    }
  }

  const errorMessage = extractErrorMessage(error);

  // If headers already sent (mid-stream error), write error to stream.
  // Clients (like AI SDK) detect errors via HTTP status code, but we can't change
  // the status after headers are committed - so SSE error event is our only option.
  if (isStreaming && reply.sent) {
    const errorEvent = {
      type: "error",
      error: {
        type: "api_error",
        message: errorMessage,
      },
    };
    reply.raw.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
    reply.raw.end();
    return reply;
  }

  // Headers not sent yet - throw ApiError to let central handler return proper status code
  // This matches V1 handler behavior and ensures clients receive correct HTTP status
  throw new ApiError(statusCode, errorMessage);
}
