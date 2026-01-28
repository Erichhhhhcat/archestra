import { archestraApiSdk, type archestraApiTypes } from "@shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { showErrorToastFromApiError } from "./utils";

export type SupportedChatProvider =
  archestraApiTypes.GetChatApiKeysResponses["200"][number]["provider"];

export type ChatApiKeyScope =
  archestraApiTypes.GetChatApiKeysResponses["200"][number]["scope"];

export type ChatApiKey =
  archestraApiTypes.GetChatApiKeysResponses["200"][number];

const {
  getChatApiKeys,
  getAvailableChatApiKeys,
  createChatApiKey,
  updateChatApiKey,
  deleteChatApiKey,
  invalidateChatModelsCache,
} = archestraApiSdk;

export function useChatApiKeys() {
  return useQuery({
    queryKey: ["chat-api-keys"],
    queryFn: async () => {
      const { data, error } = await getChatApiKeys();
      if (error) {
        showErrorToastFromApiError(error);
        return [];
      }
      return data ?? [];
    },
  });
}

export function useAvailableChatApiKeys(provider?: SupportedChatProvider) {
  return useQuery({
    queryKey: ["available-chat-api-keys", provider],
    queryFn: async () => {
      const { data, error } = await getAvailableChatApiKeys({
        query: provider ? { provider } : undefined,
      });
      if (error) {
        showErrorToastFromApiError(error);
        return [];
      }
      return data ?? [];
    },
  });
}

export function useCreateChatApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: archestraApiTypes.CreateChatApiKeyData["body"],
    ) => {
      const { data: responseData, error } = await createChatApiKey({
        body: data,
      });
      if (error) {
        showErrorToastFromApiError(error);
        return null;
      }
      return responseData;
    },
    onSuccess: (result) => {
      if (!result) return; // Error already shown via toast
      toast.success("API key created successfully");
      queryClient.invalidateQueries({ queryKey: ["chat-api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["available-chat-api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["chat-models"] });
    },
  });
}

export function useUpdateChatApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: archestraApiTypes.UpdateChatApiKeyData["body"];
    }) => {
      const { data: responseData, error } = await updateChatApiKey({
        path: { id },
        body: data,
      });
      if (error) {
        showErrorToastFromApiError(error);
        return null;
      }
      return responseData;
    },
    onSuccess: (result) => {
      if (!result) return; // Error already shown via toast
      toast.success("API key updated successfully");
      queryClient.invalidateQueries({ queryKey: ["chat-api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["available-chat-api-keys"] });
    },
  });
}

export function useDeleteChatApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: responseData, error } = await deleteChatApiKey({
        path: { id },
      });
      if (error) {
        showErrorToastFromApiError(error);
        return null;
      }
      return responseData;
    },
    onSuccess: (result) => {
      if (result === null) return; // Error already shown via toast
      queryClient.invalidateQueries({ queryKey: ["chat-api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["available-chat-api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["chat-models"] });
    },
  });
}

export function useInvalidateChatModelsCache() {
  return useMutation({
    mutationFn: async () => {
      const { data: responseData, error } = await invalidateChatModelsCache();
      if (error) {
        const msg =
          typeof error.error === "string"
            ? error.error
            : error.error?.message || "Failed to invalidate models cache";
        toast.error(msg);
      }
      return responseData;
    },
    onSuccess: () => {
      toast.success("Models cache refreshed");
    },
  });
}
