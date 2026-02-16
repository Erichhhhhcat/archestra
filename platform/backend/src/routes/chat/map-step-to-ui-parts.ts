/**
 * Maps AI SDK ContentPart[] (from onStepFinish) to UIMessage parts format.
 *
 * The AI SDK's toUIMessageStream produces UIMessage parts with a specific structure
 * (e.g. type: "tool-{toolName}", state: "output-available", input/output properties).
 * When we progressively save via onStepFinish, we receive ContentPart[] which has a
 * different structure (e.g. type: "tool-call", part.input, part.output).
 *
 * This module maps ContentPart[] to the exact same UIMessage parts format so that
 * messages saved by the draft mechanism render identically to messages saved by onFinish.
 */

/**
 * A single UIMessage part in the format the AI SDK frontend expects.
 * Uses `any` because the exact shape depends on the tool and is dynamic.
 */
// biome-ignore lint/suspicious/noExplicitAny: UIMessage parts are dynamic
type UIMessagePart = Record<string, any>;

/**
 * A step content part from AI SDK's onStepFinish callback.
 * Covers text, tool-call, tool-result, tool-error, reasoning, source, and file types.
 */
export interface StepContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  providerMetadata?: Record<string, unknown>;
  // source parts
  sourceType?: "url" | "document";
  id?: string;
  url?: string;
  title?: string;
  mediaType?: string;
  filename?: string;
  // file parts
  file?: { base64?: string; mediaType?: string; uint8Array?: Uint8Array };
}

/**
 * Maps a single step's content parts into UIMessage-compatible parts,
 * mutating the accumulated parts array in place.
 *
 * Produces the same format as AI SDK's toUIMessageStream:
 * - Adds { type: "step-start" } before each step's content
 * - text       → { type: "text", text }
 * - tool-call  → { type: "tool-{toolName}", toolCallId, state: "input-available", input }
 * - tool-result→ updates matching tool part to state: "output-available" with output
 * - tool-error → updates matching tool part to state: "output-error" with errorText
 *
 * @param stepContent - ContentPart[] from onStepFinish's stepResult.content
 * @param accumulatedParts - The running array of UIMessage parts (mutated in place)
 */
export function mapStepContentToUIMessageParts(
  stepContent: StepContentPart[],
  accumulatedParts: UIMessagePart[],
): void {
  // The SDK inserts a step-start marker before each step's content
  accumulatedParts.push({ type: "step-start" });

  for (const part of stepContent) {
    switch (part.type) {
      case "text": {
        if (part.text && part.text.length > 0) {
          accumulatedParts.push({ type: "text", text: part.text });
        }
        break;
      }

      case "tool-call": {
        accumulatedParts.push({
          type: `tool-${part.toolName}`,
          toolCallId: part.toolCallId,
          state: "input-available",
          input: part.input,
          ...(part.providerMetadata != null
            ? { callProviderMetadata: part.providerMetadata }
            : {}),
        });
        break;
      }

      case "tool-result": {
        const idx = accumulatedParts.findIndex(
          (p) =>
            p.type === `tool-${part.toolName}` &&
            p.toolCallId === part.toolCallId,
        );
        if (idx >= 0) {
          accumulatedParts[idx] = {
            ...accumulatedParts[idx],
            state: "output-available",
            output: part.output,
          };
        }
        break;
      }

      case "tool-error": {
        const idx = accumulatedParts.findIndex(
          (p) =>
            p.type === `tool-${part.toolName}` &&
            p.toolCallId === part.toolCallId,
        );
        if (idx >= 0) {
          const errorText =
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === "string"
                ? part.error
                : JSON.stringify(part.error);
          accumulatedParts[idx] = {
            ...accumulatedParts[idx],
            state: "output-error",
            errorText,
          };
        }
        break;
      }

      case "reasoning": {
        accumulatedParts.push({
          type: "reasoning",
          text: part.text,
          providerMetadata: part.providerMetadata,
          state: "done",
        });
        break;
      }

      case "source": {
        if (part.sourceType === "url") {
          accumulatedParts.push({
            type: "source-url",
            sourceId: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: part.providerMetadata,
          });
        } else if (part.sourceType === "document") {
          accumulatedParts.push({
            type: "source-document",
            sourceId: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: part.providerMetadata,
          });
        }
        break;
      }

      case "file": {
        if (part.file) {
          const mediaType = part.file.mediaType;
          const base64 = part.file.base64;
          accumulatedParts.push({
            type: "file",
            mediaType,
            url: `data:${mediaType};base64,${base64}`,
          });
        }
        break;
      }

      default:
        break;
    }
  }
}
