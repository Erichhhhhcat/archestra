"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useFeatures } from "@/lib/features.query";

export function SecurityEngineWarning() {
  const { data: features, isLoading } = useFeatures();
  const isPermissive = features?.globalToolPolicy === "permissive";

  // Loading state - don't show anything yet
  if (isLoading || features === undefined) {
    return null;
  }

  // If security engine is not disabled, don't show warning
  if (!isPermissive) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-destructive/10 text-destructive text-xs border-b border-destructive/20">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">Security Engine Disabled</span>
      <span className="text-destructive/80">
        — Agents can perform dangerous actions without supervision.
      </span>
      <Link href="/tools" className="underline ml-auto shrink-0">
        Go to Tools Settings
      </Link>
    </div>
  );
}
