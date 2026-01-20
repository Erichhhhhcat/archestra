import logger from "@/logging";
import {
  OptimizationRuleModel,
  ProfileTeamModel,
  TeamModel,
  TokenPriceModel,
} from "@/models";
import { getTokenizer } from "@/tokenizers";
import type {
  Anthropic,
  Cerebras,
  Gemini,
  OpenAi,
  Profile,
  Vllm,
  Zhipuai,
} from "@/types";

type ProviderMessages = {
  anthropic: Anthropic.Types.MessagesRequest["messages"];
  cerebras: Cerebras.Types.ChatCompletionsRequest["messages"];
  gemini: Gemini.Types.GenerateContentRequest["contents"];
  openai: OpenAi.Types.ChatCompletionsRequest["messages"];
  vllm: Vllm.Types.ChatCompletionsRequest["messages"];
  ollama: Vllm.Types.ChatCompletionsRequest["messages"];
  zhipuai: Zhipuai.Types.ChatCompletionsRequest["messages"];
};

/**
 * Get optimized model based on dynamic optimization rules
 * Returns the optimized model name or null if no optimization applies
 */
export async function getOptimizedModel<
  Provider extends keyof ProviderMessages,
>(
  profile: Profile,
  messages: ProviderMessages[Provider],
  provider: Provider,
  hasTools: boolean,
): Promise<string | null> {
  const profileId = profile.id;

  // Get organizationId the same way limits do: from profile's teams OR fallback
  let organizationId: string | null = null;
  const profileTeamIds = await ProfileTeamModel.getTeamsForProfile(profileId);

  if (profileTeamIds.length > 0) {
    // Get organizationId from profile's first team
    const teams = await TeamModel.findByIds(profileTeamIds);
    if (teams.length > 0 && teams[0].organizationId) {
      organizationId = teams[0].organizationId;
      logger.info(
        { profileId, organizationId },
        "[CostOptimization] resolved organizationId from team",
      );
    }
  } else {
    // If profile has no teams, check if there are any organization optimization rules to apply (fallback)
    // TODO: this fallback doesn't work if there are multiple organizations.
    organizationId = await OptimizationRuleModel.getFirstOrganizationId();

    if (organizationId) {
      logger.info(
        { profileId, organizationId },
        "[CostOptimization] profile has no teams - using fallback organization",
      );
    }
  }

  if (!organizationId) {
    logger.warn(
      { profileId },
      "[CostOptimization] could not resolve organizationId",
    );
    return null;
  }

  // Fetch enabled optimization rules for this organization, profile, and provider
  const rules =
    await OptimizationRuleModel.findEnabledByOrganizationAndProvider(
      organizationId,
      provider,
    );

  if (rules.length === 0) {
    logger.info(
      { profileId, organizationId, provider },
      "[CostOptimization] no optimization rules configured",
    );
    return null;
  }

  // Use provider-specific tokenizer to count tokens
  const tokenizer = getTokenizer(provider);
  const tokenCount = tokenizer.countTokens(messages);

  logger.info(
    { tokenCount, hasTools },
    "[CostOptimization] LLM request evaluated",
  );

  // Evaluate rules and return optimized model (or null if no rule matches)
  const optimizedModel = OptimizationRuleModel.matchByRules(rules, {
    tokenCount,
    hasTools,
  });

  if (optimizedModel) {
    logger.info(
      { profileId, optimizedModel },
      "[CostOptimization] optimization rule matched",
    );
  } else {
    logger.info(
      { profileId },
      "[CostOptimization] no optimization rule matched",
    );
  }

  return optimizedModel;
}

/**
 * Calculate cost for token usage based on model pricing
 * Returns undefined if pricing is not available for the model
 */
export async function calculateCost(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): Promise<number | undefined> {
  if (!inputTokens || !outputTokens) {
    return undefined;
  }

  const pricing = await TokenPriceModel.findByModel(model);
  if (!pricing) {
    return undefined;
  }

  const inputCost =
    (inputTokens / 1_000_000) * Number.parseFloat(pricing.pricePerMillionInput);
  const outputCost =
    (outputTokens / 1_000_000) *
    Number.parseFloat(pricing.pricePerMillionOutput);

  return inputCost + outputCost;
}
