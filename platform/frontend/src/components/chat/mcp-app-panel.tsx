"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface McpAppPanelProps {
  /** The URL of the MCP App to render */
  appUrl: string | null;
  /** Title of the MCP App */
  appTitle?: string;
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when the panel is closed */
  onClose: () => void;
}

/**
 * MCP App Panel - Renders MCP Apps in a sandboxed iframe
 *
 * This component provides secure rendering of MCP Apps (graphical tools)
 * that use the MCP UI protocol. It uses a sandboxed iframe for security
 * and communicates via postMessage for dynamic resizing.
 *
 * @see https://modelcontextprotocol.io/docs/extensions/apps
 */
export function McpAppPanel({
  appUrl,
  appTitle = "MCP App",
  isOpen,
  onClose,
}: McpAppPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(500);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Handle messages from the iframe for dynamic resizing
  useEffect(() => {
    if (!isOpen || !appUrl) return;

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }

      // Handle resize messages from MCP UI protocol
      if (event.data && typeof event.data === "object") {
        if (event.data.type === "mcpui-height" && typeof event.data.height === "number") {
          setHeight(event.data.height);
        } else if (event.data.type === "mcpui-ready") {
          setIsLoading(false);
        } else if (event.data.type === "mcpui-error") {
          setError(event.data.message || "An error occurred in the MCP App");
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isOpen, appUrl]);

  // Reset state when URL changes
  useEffect(() => {
    if (appUrl) {
      setIsLoading(true);
      setError(null);
      setHeight(500);
    }
  }, [appUrl]);

  // Handle iframe load event
  const handleLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Handle iframe error
  const handleError = useCallback(() => {
    setIsLoading(false);
    setError("Failed to load the MCP App");
  }, []);

  // Don't render if nothing is open or no URL
  if (!isOpen || !appUrl) {
    return null;
  }

  return (
    <div className="h-full border-l bg-background flex flex-col relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded">
            APP
          </span>
          <span className="font-medium text-sm truncate">{appTitle}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Close MCP App panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm">Loading MCP App...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <div className="text-destructive text-sm p-4 text-center">{error}</div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={appUrl}
          title={appTitle}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          style={{ height: `${height}px` }}
          className="w-full border-0"
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    </div>
  );
}

/**
 * Event types for MCP App communication
 */
export const MCP_APP_EVENTS = {
  OPEN: "OPEN_MCP_APP",
  CLOSE: "CLOSE_MCP_APP",
} as const;

/**
 * Custom event for opening an MCP App
 */
export interface OpenMcpAppEventDetail {
  url: string;
  title?: string;
}

/**
 * Dispatch an event to open an MCP App
 */
export function dispatchOpenMcpAppEvent(detail: OpenMcpAppEventDetail) {
  window.dispatchEvent(
    new CustomEvent(MCP_APP_EVENTS.OPEN, { detail }),
  );
}

/**
 * Dispatch an event to close the MCP App panel
 */
export function dispatchCloseMcpAppEvent() {
  window.dispatchEvent(new CustomEvent(MCP_APP_EVENTS.CLOSE));
}
