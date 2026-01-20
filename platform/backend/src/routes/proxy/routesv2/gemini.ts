import fastifyHttpProxy from "@fastify/http-proxy";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import config from "@/config";
import logger from "@/logging";
import {
  constructResponseSchema,
  ErrorResponsesSchema,
  Gemini,
  UuidIdSchema,
} from "@/types";
import {
  type GeminiRequestWithModel,
  geminiAdapterFactory,
} from "../adapterV2/gemini";
import { PROXY_API_PREFIX, PROXY_BODY_LIMIT } from "../common";
import { handleLLMProxy } from "../llm-proxy-handler";
import * as utils from "../utils";

/**
 * NOTE: Gemini uses colon-literals in their routes. For fastify, double colon is used to escape the colon-literal in
 * the route
 */
const geminiProxyRoutesV2: FastifyPluginAsyncZod = async (fastify) => {
  const API_PREFIX = `${PROXY_API_PREFIX}/gemini`;

  logger.info("[UnifiedProxy] Registering unified Gemini V2 routes");

  /**
   * Register HTTP proxy for all Gemini routes EXCEPT generateContent and streamGenerateContent
   * This will proxy routes like /v1/gemini/models to https://generativelanguage.googleapis.com/v1beta/models
   */
  await fastify.register(fastifyHttpProxy, {
    upstream: config.llm.gemini.baseUrl,
    prefix: `${API_PREFIX}/v1beta`,
    rewritePrefix: "/v1",
    /**
     * Exclude generateContent and streamGenerateContent routes since we handle them below
     */
    preHandler: (request, _reply, next) => {
      if (
        request.method === "POST" &&
        (request.url.includes(":generateContent") ||
          request.url.includes(":streamGenerateContent"))
      ) {
        // Skip proxy for these routes - we handle them below
        next(new Error("skip"));
      } else {
        next();
      }
    },
  });

  await fastify.register(fastifyHttpProxy, {
    upstream: config.llm.gemini.baseUrl,
    prefix: `${API_PREFIX}/:profileId/v1beta`,
    rewritePrefix: "/v1",
    /**
     * Exclude generateContent and streamGenerateContent routes since we handle them below
     */
    preHandler: (request, _reply, next) => {
      if (
        request.method === "POST" &&
        (request.url.includes(":generateContent") ||
          request.url.includes(":streamGenerateContent"))
      ) {
        // Skip proxy for these routes - we handle them below
        next(new Error("skip"));
      } else {
        next();
      }
    },
  });

  /**
   * Generate route endpoint pattern for Gemini
   * Uses regex param syntax to handle the colon-literal properly
   */
  const generateRouteEndpoint = (
    verb: "generateContent" | "streamGenerateContent",
    includeProfileId = false,
  ) =>
    `${API_PREFIX}/${includeProfileId ? ":profileId/" : ""}v1beta/models/:model(^[a-zA-Z0-9-.]+$)::${verb}`;

  /**
   * Default profile endpoint for Gemini generateContent (non-streaming)
   */
  fastify.post(
    generateRouteEndpoint("generateContent"),
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        description: "Generate content using Gemini (default profile)",
        summary: "Generate content using Gemini",
        tags: ["llm-proxy"],
        params: z.object({
          model: z.string().describe("The model to use"),
        }),
        headers: Gemini.API.GenerateContentHeadersSchema,
        body: Gemini.API.GenerateContentRequestSchema,
        response: constructResponseSchema(
          Gemini.API.GenerateContentResponseSchema,
        ),
      },
    },
    async (request, reply) => {
      logger.debug(
        { url: request.url, model: request.params.model },
        "[UnifiedProxy] Handling Gemini request (default profile, non-streaming)",
      );
      const externalAgentId = utils.externalAgentId.getExternalAgentId(
        request.headers,
      );
      const userId = await utils.userId.getUserId(request.headers);

      // Inject model and streaming flag into body for adapter
      const requestWithModel: GeminiRequestWithModel = {
        ...request.body,
        _model: request.params.model,
        _isStreaming: false,
      };

      return handleLLMProxy(
        requestWithModel,
        request.headers,
        reply,
        geminiAdapterFactory,
        {
          organizationId: request.organizationId,
          profileId: undefined,
          externalAgentId,
          userId,
        },
      );
    },
  );

  /**
   * Default profile endpoint for Gemini streamGenerateContent (streaming)
   */
  fastify.post(
    generateRouteEndpoint("streamGenerateContent"),
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        description: "Stream generated content using Gemini (default profile)",
        summary: "Stream generated content using Gemini",
        tags: ["llm-proxy"],
        params: z.object({
          model: z.string().describe("The model to use"),
        }),
        headers: Gemini.API.GenerateContentHeadersSchema,
        body: Gemini.API.GenerateContentRequestSchema,
        // Streaming responses don't have a schema
        response: ErrorResponsesSchema,
      },
    },
    async (request, reply) => {
      logger.debug(
        { url: request.url, model: request.params.model },
        "[UnifiedProxy] Handling Gemini request (default profile, streaming)",
      );
      const externalAgentId = utils.externalAgentId.getExternalAgentId(
        request.headers,
      );
      const userId = await utils.userId.getUserId(request.headers);

      // Inject model and streaming flag into body for adapter
      const requestWithModel: GeminiRequestWithModel = {
        ...request.body,
        _model: request.params.model,
        _isStreaming: true,
      };

      return handleLLMProxy(
        requestWithModel,
        request.headers,
        reply,
        geminiAdapterFactory,
        {
          organizationId: request.organizationId,
          profileId: undefined,
          externalAgentId,
          userId,
        },
      );
    },
  );

  /**
   * Profile-specific endpoint for Gemini generateContent (non-streaming)
   */
  fastify.post(
    generateRouteEndpoint("generateContent", true),
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        description: "Generate content using Gemini with specific profile",
        summary: "Generate content using Gemini (specific profile)",
        tags: ["llm-proxy"],
        params: z.object({
          profileId: UuidIdSchema,
          model: z.string().describe("The model to use"),
        }),
        headers: Gemini.API.GenerateContentHeadersSchema,
        body: Gemini.API.GenerateContentRequestSchema,
        response: constructResponseSchema(
          Gemini.API.GenerateContentResponseSchema,
        ),
      },
    },
    async (request, reply) => {
      logger.debug(
        {
          url: request.url,
          profileId: request.params.profileId,
          model: request.params.model,
        },
        "[UnifiedProxy] Handling Gemini request (with profile, non-streaming)",
      );
      const externalAgentId = utils.externalAgentId.getExternalAgentId(
        request.headers,
      );
      const userId = await utils.userId.getUserId(request.headers);

      // Inject model and streaming flag into body for adapter
      const requestWithModel: GeminiRequestWithModel = {
        ...request.body,
        _model: request.params.model,
        _isStreaming: false,
      };

      return handleLLMProxy(
        requestWithModel,
        request.headers,
        reply,
        geminiAdapterFactory,
        {
          organizationId: request.organizationId,
          profileId: request.params.profileId,
          externalAgentId,
          userId,
        },
      );
    },
  );

  /**
   * Profile-specific endpoint for Gemini streamGenerateContent (streaming)
   */
  fastify.post(
    generateRouteEndpoint("streamGenerateContent", true),
    {
      bodyLimit: PROXY_BODY_LIMIT,
      schema: {
        description:
          "Stream generated content using Gemini with specific profile",
        summary: "Stream generated content using Gemini (specific profile)",
        tags: ["llm-proxy"],
        params: z.object({
          profileId: UuidIdSchema,
          model: z.string().describe("The model to use"),
        }),
        headers: Gemini.API.GenerateContentHeadersSchema,
        body: Gemini.API.GenerateContentRequestSchema,
        // Streaming responses don't have a schema
        response: ErrorResponsesSchema,
      },
    },
    async (request, reply) => {
      logger.debug(
        {
          url: request.url,
          profileId: request.params.profileId,
          model: request.params.model,
        },
        "[UnifiedProxy] Handling Gemini request (with profile, streaming)",
      );
      const externalAgentId = utils.externalAgentId.getExternalAgentId(
        request.headers,
      );
      const userId = await utils.userId.getUserId(request.headers);

      // Inject model and streaming flag into body for adapter
      const requestWithModel: GeminiRequestWithModel = {
        ...request.body,
        _model: request.params.model,
        _isStreaming: true,
      };

      return handleLLMProxy(
        requestWithModel,
        request.headers,
        reply,
        geminiAdapterFactory,
        {
          organizationId: request.organizationId,
          profileId: request.params.profileId,
          externalAgentId,
          userId,
        },
      );
    },
  );
};

export default geminiProxyRoutesV2;
