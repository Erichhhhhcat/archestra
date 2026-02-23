"use client";

import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from "@shared";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDefaultCredentialsEnabled } from "@/lib/auth.query";
import { authClient } from "@/lib/clients/auth/auth-client";
import { useFeatures } from "@/lib/config.query";

export function SidebarWarningsAccordion() {
  const { data: session } = authClient.useSession();
  const userEmail = session?.user?.email;
  const { data: defaultCredentialsEnabled, isLoading: isLoadingCreds } =
    useDefaultCredentialsEnabled();
  const { data: features, isLoading: isLoadingFeatures } = useFeatures();

  const isPermissive = features?.globalToolPolicy === "permissive";

  // Determine which warnings should be shown
  const showSecurityEngineWarning =
    !isLoadingFeatures && features !== undefined && isPermissive;
  const showDefaultCredsWarning =
    !isLoadingCreds &&
    defaultCredentialsEnabled !== undefined &&
    defaultCredentialsEnabled &&
    userEmail === DEFAULT_ADMIN_EMAIL;

  // Count active warnings
  const warningCount =
    (showSecurityEngineWarning ? 1 : 0) + (showDefaultCredsWarning ? 1 : 0);

  // Don't render anything if no warnings
  if (warningCount === 0) {
    return null;
  }

  return (
    <div className="px-2 pb-1">
      <Accordion type="single" collapsible defaultValue="warnings">
        <AccordionItem value="warnings" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs font-medium text-destructive hover:no-underline">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warningCount} security{" "}
              {warningCount === 1 ? "warning" : "warnings"}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0 pt-0 space-y-2">
            {showSecurityEngineWarning && (
              <Alert variant="destructive" className="text-xs">
                <AlertTitle className="text-xs font-semibold">
                  Security Engine Disabled
                </AlertTitle>
                <AlertDescription className="text-xs mt-1">
                  <p>
                    Agents can perform dangerous actions without supervision.
                  </p>
                  <p className="mt-1">
                    <Link
                      href="/tool-policies"
                      className="inline-flex items-center underline"
                    >
                      Go to Tools Settings
                    </Link>
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {showDefaultCredsWarning && (
              <Alert variant="destructive" className="text-xs">
                <AlertTitle className="text-xs font-semibold">
                  Default Admin Credentials Enabled
                </AlertTitle>
                <AlertDescription className="text-xs mt-1">
                  <div className="space-y-1">
                    <code className="break-all block">
                      - {DEFAULT_ADMIN_EMAIL}
                    </code>
                    <code className="break-all block">
                      - {DEFAULT_ADMIN_PASSWORD}
                    </code>
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
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
