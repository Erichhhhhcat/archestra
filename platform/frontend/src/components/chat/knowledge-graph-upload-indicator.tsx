"use client";

import { countTextDocuments, type FileInfo } from "@shared";
import { DatabaseIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFeatureValue } from "@/lib/features.hook";

interface KnowledgeGraphUploadIndicatorProps {
  /** Array of attached files with their metadata */
  files: FileInfo[];
}

/**
 * Shows a small indicator when supported documents are attached and a knowledge graph provider is configured.
 * Text-based documents and PDFs will be ingested into the knowledge graph (not images, audio, video).
 * Displays a database icon with short text, and a tooltip with more details on hover.
 */
export function KnowledgeGraphUploadIndicator({
  files,
}: KnowledgeGraphUploadIndicatorProps) {
  const knowledgeGraph = useFeatureValue("knowledgeGraph");

  // Count only text documents that will actually be ingested
  const textDocumentCount = countTextDocuments(files);

  // Don't show if no knowledge graph is configured or no text documents are attached
  if (!knowledgeGraph?.enabled || textDocumentCount === 0) {
    return null;
  }

  const displayName = knowledgeGraph.displayName ?? "Knowledge Graph";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-help">
          <DatabaseIcon className="size-3.5" />
          <span>KG Upload</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p>
          {textDocumentCount === 1
            ? `This text document will be ingested into ${displayName} for enhanced search and retrieval.`
            : `These ${textDocumentCount} text documents will be ingested into ${displayName} for enhanced search and retrieval.`}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
