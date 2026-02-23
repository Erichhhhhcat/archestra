"use client";

import type { archestraApiTypes } from "@shared";
import { Edit, Plus, Save, Settings, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { CatalogItem } from "@/app/mcp-catalog/_parts/mcp-server-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionButton } from "@/components/ui/permission-button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInternalMcpCatalog } from "@/lib/internal-mcp-catalog.query";
import {
  useCreateLimit,
  useDeleteLimit,
  useLimits,
  useUpdateLimit,
} from "@/lib/limits.query";
import { useOrganization } from "@/lib/organization.query";
import { useTeams } from "@/lib/team.query";

type LimitData = archestraApiTypes.GetLimitsResponses["200"][number];
type TeamData = archestraApiTypes.GetTeamsResponses["200"][number];
type UsageStatus = "safe" | "warning" | "danger";

const WINDOW_PRESETS = [
  { label: "1 minute", value: 60_000 },
  { label: "1 hour", value: 3_600_000 },
  { label: "1 day", value: 86_400_000 },
  { label: "1 week", value: 604_800_000 },
  { label: "1 month", value: 2_592_000_000 },
] as const;

function formatWindowMs(windowMs: number): string {
  const preset = WINDOW_PRESETS.find((p) => p.value === windowMs);
  if (preset) return preset.label;
  const seconds = windowMs / 1000;
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours}h`;
}

function McpLimitInlineForm({
  initialData,
  onSave,
  onCancel,
  teams,
  mcpServers,
  hasOrganizationMcpLimit,
  getTeamsWithMcpLimits,
  organizationId,
}: {
  initialData?: LimitData;
  onSave: (data: archestraApiTypes.CreateLimitData["body"]) => void;
  onCancel: () => void;
  teams: TeamData[];
  mcpServers: CatalogItem[];
  hasOrganizationMcpLimit: (mcpServerName?: string) => boolean;
  getTeamsWithMcpLimits: (mcpServerName?: string) => string[];
  organizationId: string;
}) {
  const [formData, setFormData] = useState({
    entityType:
      (initialData?.entityType as "organization" | "team") || "organization",
    entityId: initialData?.entityId || "",
    mcpServerName: initialData?.mcpServerName || "",
    limitValue: initialData?.limitValue?.toString() || "",
    windowMs: initialData?.windowMs?.toString() || "3600000",
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSave({
        entityType: formData.entityType,
        entityId:
          formData.entityType === "organization"
            ? organizationId
            : formData.entityId,
        limitType: "mcp_server_calls",
        limitValue: parseInt(formData.limitValue, 10),
        mcpServerName: formData.mcpServerName,
        windowMs: parseInt(formData.windowMs, 10),
      });
    },
    [formData, onSave, organizationId],
  );

  const isValid =
    formData.limitValue &&
    formData.mcpServerName &&
    formData.windowMs &&
    (formData.entityType === "organization" || formData.entityId);

  return (
    <tr className="border-b">
      <td colSpan={6} className="p-4 bg-muted/30">
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-4"
        >
          <div className="flex items-center gap-2">
            <Label htmlFor="entityType" className="text-sm whitespace-nowrap">
              Apply To
            </Label>
            <Select
              value={formData.entityType}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  entityType: value as "organization" | "team",
                  entityId: "",
                })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">
                  The whole organization
                </SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.entityType === "team" && (
            <div className="flex items-center gap-2">
              <Label htmlFor="team" className="text-sm whitespace-nowrap">
                Team
              </Label>
              <Select
                value={formData.entityId}
                onValueChange={(value) =>
                  setFormData({ ...formData, entityId: value })
                }
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No teams available
                    </div>
                  ) : (
                    teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Label htmlFor="mcpServer" className="text-sm whitespace-nowrap">
              MCP Server
            </Label>
            <Select
              value={formData.mcpServerName}
              onValueChange={(value) =>
                setFormData({ ...formData, mcpServerName: value })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select an MCP server" />
              </SelectTrigger>
              <SelectContent>
                {mcpServers.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No MCP servers available
                  </div>
                ) : (
                  mcpServers.map((server) => {
                    const isDisabled =
                      (formData.entityType === "organization" &&
                        hasOrganizationMcpLimit(server.name)) ||
                      (formData.entityType === "team" &&
                        formData.entityId &&
                        formData.entityId.trim() !== "" &&
                        getTeamsWithMcpLimits(server.name)?.includes(
                          formData.entityId,
                        ));

                    return (
                      <SelectItem
                        key={server.id}
                        value={server.name}
                        disabled={Boolean(isDisabled)}
                      >
                        {server.name}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="windowMs" className="text-sm whitespace-nowrap">
              Window
            </Label>
            <Select
              value={formData.windowMs}
              onValueChange={(value) =>
                setFormData({ ...formData, windowMs: value })
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_PRESETS.map((preset) => (
                  <SelectItem
                    key={preset.value}
                    value={preset.value.toString()}
                  >
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="limitValue" className="text-sm whitespace-nowrap">
              Max Calls
            </Label>
            <Input
              id="limitValue"
              type="text"
              value={
                formData.limitValue
                  ? parseInt(formData.limitValue, 10).toLocaleString()
                  : ""
              }
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9]/g, "");
                setFormData({ ...formData, limitValue: value });
              }}
              placeholder="e.g. 1,000"
              min="1"
              required
              className="w-32"
            />
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <Button type="submit" disabled={!isValid} size="sm">
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              size="sm"
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function McpLimitRow({
  limit,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  teams,
  mcpServers,
  getEntityName,
  hasOrganizationMcpLimit,
  getTeamsWithMcpLimits,
  organizationId,
}: {
  limit: LimitData;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (data: archestraApiTypes.CreateLimitData["body"]) => void;
  onCancel: () => void;
  onDelete: () => void;
  teams: TeamData[];
  mcpServers: CatalogItem[];
  getEntityName: (limit: LimitData) => string;
  hasOrganizationMcpLimit: (mcpServerName?: string) => boolean;
  getTeamsWithMcpLimits: (mcpServerName?: string) => string[];
  organizationId: string;
}) {
  if (isEditing) {
    return (
      <McpLimitInlineForm
        initialData={limit}
        onSave={onSave}
        onCancel={onCancel}
        teams={teams}
        mcpServers={mcpServers}
        hasOrganizationMcpLimit={hasOrganizationMcpLimit}
        getTeamsWithMcpLimits={getTeamsWithMcpLimits}
        organizationId={organizationId}
      />
    );
  }

  const mcpUsage = (limit as LimitData & { mcpUsage?: number }).mcpUsage ?? 0;
  const percentage = (mcpUsage / limit.limitValue) * 100;
  let status: UsageStatus = "safe";
  if (percentage >= 90) status = "danger";
  else if (percentage >= 75) status = "warning";

  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="p-4">
        <Badge
          variant={
            status === "danger"
              ? "destructive"
              : status === "warning"
                ? "secondary"
                : "default"
          }
        >
          {status === "danger"
            ? "Exceeded"
            : status === "warning"
              ? "Near Limit"
              : "Safe"}
        </Badge>
      </td>
      <td className="p-4 text-sm text-muted-foreground">
        {getEntityName(limit)}
      </td>
      <td className="p-4 text-sm text-muted-foreground">
        {limit.mcpServerName || "-"}
      </td>
      <td className="p-4 text-sm text-muted-foreground">
        {limit.windowMs ? formatWindowMs(limit.windowMs) : "-"}
      </td>
      <td className="p-4">
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>
              {mcpUsage.toLocaleString()} / {limit.limitValue.toLocaleString()}{" "}
              calls
            </span>
            <span>{percentage.toFixed(1)}%</span>
          </div>
          <Progress
            value={Math.min(percentage, 100)}
            className={`h-2 ${
              status === "danger"
                ? "bg-red-100"
                : status === "warning"
                  ? "bg-orange-100"
                  : ""
            }`}
          />
        </div>
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <PermissionButton
            permissions={{ limit: ["update"] }}
            variant="ghost"
            size="sm"
            onClick={onEdit}
          >
            <Edit className="h-4 w-4" />
          </PermissionButton>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <PermissionButton
                permissions={{ limit: ["delete"] }}
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </PermissionButton>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete MCP Rate Limit</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this rate limit? This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </td>
    </tr>
  );
}

export default function McpRateLimitsPage() {
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const { data: limits = [], isLoading } = useLimits({
    limitType: "mcp_server_calls",
  });
  const { data: mcpServers = [] } = useInternalMcpCatalog();
  const { data: teams = [] } = useTeams();
  const { data: organizationDetails } = useOrganization();

  const deleteLimit = useDeleteLimit();
  const createLimit = useCreateLimit();
  const updateLimit = useUpdateLimit();

  const hasOrganizationMcpLimit = useCallback(
    (mcpServerName?: string) => {
      return limits.some(
        (limit) =>
          limit.entityType === "organization" &&
          limit.mcpServerName === mcpServerName,
      );
    },
    [limits],
  );

  const getTeamsWithMcpLimits = useCallback(
    (mcpServerName?: string) => {
      return limits
        .filter(
          (limit) =>
            limit.entityType === "team" &&
            limit.mcpServerName === mcpServerName,
        )
        .map((limit) => limit.entityId);
    },
    [limits],
  );

  const getEntityName = useCallback(
    (limit: LimitData) => {
      if (limit.entityType === "team") {
        const team = teams.find((t) => t.id === limit.entityId);
        return team?.name || "Unknown Team";
      }
      if (limit.entityType === "organization") {
        return "The whole organization";
      }
      return limit.entityId;
    },
    [teams],
  );

  const handleCreate = useCallback(
    async (data: archestraApiTypes.CreateLimitData["body"]) => {
      try {
        await createLimit.mutateAsync(data);
        setIsAdding(false);
      } catch {
        // Error handled by mutation hook
      }
    },
    [createLimit],
  );

  const handleUpdate = useCallback(
    async (id: string, data: archestraApiTypes.CreateLimitData["body"]) => {
      try {
        await updateLimit.mutateAsync({ id, ...data });
        setEditingLimitId(null);
      } catch {
        // Error handled by mutation hook
      }
    },
    [updateLimit],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteLimit.mutateAsync({ id });
    },
    [deleteLimit],
  );

  const handleCancel = useCallback(() => {
    setEditingLimitId(null);
    setIsAdding(false);
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">MCP Rate Limits</CardTitle>
              <CardDescription>
                Rate limits for MCP server tool calls. Limits use a sliding
                window to control the number of calls within a time period.
              </CardDescription>
            </div>
            <PermissionButton
              permissions={{ limit: ["create"] }}
              onClick={() => setIsAdding(true)}
              size="sm"
              disabled={isAdding || editingLimitId !== null}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Rate Limit
            </PermissionButton>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={`mcp-skeleton-${i}`}
                  className="h-16 bg-muted animate-pulse rounded"
                />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Applied to</TableHead>
                  <TableHead>MCP Server</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isAdding && (
                  <McpLimitInlineForm
                    onSave={handleCreate}
                    onCancel={handleCancel}
                    teams={teams}
                    mcpServers={mcpServers}
                    hasOrganizationMcpLimit={hasOrganizationMcpLimit}
                    getTeamsWithMcpLimits={getTeamsWithMcpLimits}
                    organizationId={organizationDetails?.id || ""}
                  />
                )}
                {limits.length === 0 && !isAdding ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No MCP rate limits configured</p>
                      <p className="text-sm">
                        Click &quot;Add Rate Limit&quot; to get started
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  limits.map((limit) => (
                    <McpLimitRow
                      key={limit.id}
                      limit={limit}
                      isEditing={editingLimitId === limit.id}
                      onEdit={() => setEditingLimitId(limit.id)}
                      onSave={(data) => handleUpdate(limit.id, data)}
                      onCancel={handleCancel}
                      onDelete={() => handleDelete(limit.id)}
                      teams={teams}
                      mcpServers={mcpServers}
                      getEntityName={getEntityName}
                      hasOrganizationMcpLimit={hasOrganizationMcpLimit}
                      getTeamsWithMcpLimits={getTeamsWithMcpLimits}
                      organizationId={organizationDetails?.id || ""}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
