"use client";

import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from "@shared";
import { AlertTriangle } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDefaultCredentialsEnabled } from "@/lib/auth.query";
import { authClient } from "@/lib/clients/auth/auth-client";

export function DefaultCredentialsWarning({
  alwaysShow = false,
}: {
  alwaysShow?: boolean;
}) {
  const { data: session } = authClient.useSession();
  const userEmail = session?.user?.email;
  const { data: defaultCredentialsEnabled, isLoading } =
    useDefaultCredentialsEnabled();

  // Loading state - don't show anything yet
  if (isLoading || defaultCredentialsEnabled === undefined) {
    return null;
  }

  // If default credentials are not enabled, don't show warning
  if (!defaultCredentialsEnabled) {
    return null;
  }

  // For authenticated users, only show if they're using the default admin email
  if (!alwaysShow && (!userEmail || userEmail !== DEFAULT_ADMIN_EMAIL)) {
    return null;
  }

  // Sign-in page: full card-style alert
  if (alwaysShow) {
    return (
      <Alert variant="destructive" className="text-xs">
        <AlertTitle className="text-xs font-semibold">
          Default Admin Credentials Enabled
        </AlertTitle>
        <AlertDescription className="text-xs mt-1">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <code className="break-all">- {DEFAULT_ADMIN_EMAIL}</code>
              <CopyButton
                text={DEFAULT_ADMIN_EMAIL}
                className="h-4 w-4 hover:bg-transparent"
                size={10}
                behavior="text"
              />
            </div>
            <div className="flex items-center gap-1">
              <code className="break-all">- {DEFAULT_ADMIN_PASSWORD}</code>
              <CopyButton
                text={DEFAULT_ADMIN_PASSWORD}
                className="h-4 w-4 hover:bg-transparent"
                size={10}
                behavior="text"
              />
            </div>
          </div>
          <p className="mt-1">
            <a
              href="https://archestra.ai/docs/platform-deployment#environment-variables"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center underline"
            >
              Set ENV
            </a>{" "}
            or{" "}
            <a
              href="/settings/account"
              className="inline-flex items-center underline"
            >
              Change
            </a>
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // In-app: compact one-line banner
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-destructive/10 text-destructive text-xs border-b border-destructive/20">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">Default Admin Credentials</span>
      <span className="text-destructive/80">
        — <code>{DEFAULT_ADMIN_EMAIL}</code> /{" "}
        <code>{DEFAULT_ADMIN_PASSWORD}</code>
      </span>
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <a
          href="https://archestra.ai/docs/platform-deployment#environment-variables"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Set ENV
        </a>
        <span>or</span>
        <a href="/settings/account" className="underline">
          Change
        </a>
      </div>
    </div>
  );
}
