"use client";

import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { TruncatedText } from "@/components/truncated-text";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TypingText } from "@/components/ui/typing-text";
import { useIsAuthenticated } from "@/lib/auth.hook";
import { useHasPermissions } from "@/lib/auth.query";
import { useRecentlyGeneratedTitles } from "@/lib/chat.hook";
import {
  useConversations,
  useDeleteConversation,
  useGenerateConversationTitle,
  usePinConversation,
  useUpdateConversation,
} from "@/lib/chat.query";
import { getConversationDisplayTitle } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

const CONVERSATION_QUERY_PARAM = "conversation";
const MAX_PINNED_CHATS = 3;
const RECENT_UNPINNED_COUNT = 3;
const VISIBLE_CHAT_COUNT = 10;
const MAX_TITLE_LENGTH = 30;

function AISparkleIcon({ isAnimating = false }: { isAnimating?: boolean }) {
  return (
    <Sparkles
      className={`h-4 w-4 text-primary ${isAnimating ? "animate-pulse" : ""}`}
      aria-label="AI generated"
    />
  );
}

export function ChatSidebarSection() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAuthenticated = useIsAuthenticated();
  const { data: conversations = [], isLoading } = useConversations({
    enabled: isAuthenticated,
  });
  const updateConversationMutation = useUpdateConversation();
  const deleteConversationMutation = useDeleteConversation();
  const generateTitleMutation = useGenerateConversationTitle();
  const pinConversationMutation = usePinConversation();

  const [showAllChats, setShowAllChats] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: canUpdateConversation } = useHasPermissions({
    conversation: ["update"],
  });
  const { data: canDeleteConversation } = useHasPermissions({
    conversation: ["delete"],
  });

  // Track conversations with recently auto-generated titles for animation
  const { recentlyGeneratedTitles, regeneratingTitles, triggerRegeneration } =
    useRecentlyGeneratedTitles(conversations);

  const currentConversationId = pathname.startsWith("/chat")
    ? searchParams.get(CONVERSATION_QUERY_PARAM)
    : null;

  // Split conversations into pinned and unpinned
  const { pinnedChats, recentUnpinnedChats, allUnpinnedChats } = useMemo(() => {
    const pinned = conversations
      .filter((c) => c.pinnedAt)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, MAX_PINNED_CHATS);

    const pinnedIds = new Set(pinned.map((c) => c.id));
    const unpinned = conversations.filter((c) => !pinnedIds.has(c.id));

    return {
      pinnedChats: pinned,
      recentUnpinnedChats: unpinned.slice(0, RECENT_UNPINNED_COUNT),
      allUnpinnedChats: unpinned,
    };
  }, [conversations]);

  // Stabilize the "all chats" view order
  const stableOrderRef = useRef<string[] | null>(null);
  const stableUnpinnedChats = useMemo(() => {
    if (allUnpinnedChats.length === 0) {
      stableOrderRef.current = null;
      return allUnpinnedChats;
    }

    const currentIds = new Set(allUnpinnedChats.map((c) => c.id));
    const conversationMap = new Map(allUnpinnedChats.map((c) => [c.id, c]));

    if (stableOrderRef.current === null) {
      stableOrderRef.current = allUnpinnedChats.map((c) => c.id);
      return allUnpinnedChats;
    }

    const prevIds = new Set(stableOrderRef.current);
    const newIds = allUnpinnedChats
      .filter((c) => !prevIds.has(c.id))
      .map((c) => c.id);
    const keptIds = stableOrderRef.current.filter((id) => currentIds.has(id));
    const orderedIds = [...newIds, ...keptIds];

    stableOrderRef.current = orderedIds;
    return orderedIds
      .map((id) => conversationMap.get(id))
      .filter((c): c is NonNullable<typeof c> => c != null);
  }, [allUnpinnedChats]);

  const visibleUnpinnedChats = showAllChats
    ? stableUnpinnedChats
    : stableUnpinnedChats.slice(0, VISIBLE_CHAT_COUNT);
  const hiddenChatsCount = Math.max(
    0,
    stableUnpinnedChats.length - VISIBLE_CHAT_COUNT,
  );

  // Determine which chats to show in the sidebar
  // When collapsed: show pinned (up to 3) + recent unpinned (up to 3)
  // When expanded: show pinned + all unpinned
  const showExpandedView = showAllChats;

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleSelectConversation = (id: string) => {
    router.push(`/chat?${CONVERSATION_QUERY_PARAM}=${id}`);
  };

  const handleStartEdit = (id: string, currentTitle: string | null) => {
    setEditingId(id);
    setEditingTitle(currentTitle || "");
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingTitle.trim()) {
      setEditingId(null);
      setEditingTitle("");
      return;
    }

    try {
      await updateConversationMutation.mutateAsync({
        id,
        title: editingTitle.trim(),
      });
      setEditingId(null);
      setEditingTitle("");
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep editing state so user can retry
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleDeleteConversation = async (id: string) => {
    const shouldNavigate = currentConversationId === id;

    try {
      await deleteConversationMutation.mutateAsync(id);
      // Navigate only after successful deletion
      if (shouldNavigate) {
        router.push("/chat");
      }
    } catch {
      // Error is handled by the mutation's onError callback
    }
  };

  const handleRegenerateTitle = async (id: string) => {
    // Mark as regenerating (shows loading state until new title arrives)
    triggerRegeneration(id);
    // Close edit mode
    setEditingId(null);
    setEditingTitle("");
    // Regenerate the title
    await generateTitleMutation.mutateAsync({ id, regenerate: true });
  };

  const handleTogglePin = (id: string, isPinned: boolean) => {
    pinConversationMutation.mutate({ id, pinned: !isPinned });
  };

  const openConversationSearch = () => {
    window.dispatchEvent(new CustomEvent("open-conversation-search"));
  };

  const renderConversationItem = (
    conv: (typeof conversations)[number],
    showPinIcon = false,
  ) => {
    const isCurrentConversation = currentConversationId === conv.id;
    const displayTitle = getConversationDisplayTitle(conv.title, conv.messages);
    const hasRecentlyGeneratedTitle = recentlyGeneratedTitles.has(conv.id);
    const isRegenerating = regeneratingTitles.has(conv.id);
    const isMenuOpen = openMenuId === conv.id;
    const isPinned = !!conv.pinnedAt;

    return (
      <SidebarMenuItem key={conv.id}>
        <div className="flex items-center justify-between w-full gap-1">
          {editingId === conv.id ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                ref={inputRef}
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => handleSaveEdit(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveEdit(conv.id);
                  } else if (e.key === "Escape") {
                    handleCancelEdit();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-7 text-sm flex-1"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onMouseDown={(e) => {
                        // Prevent input blur from triggering handleSaveEdit
                        e.preventDefault();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRegenerateTitle(conv.id);
                      }}
                      disabled={generateTitleMutation.isPending}
                      className="h-7 w-7 shrink-0"
                    >
                      <AISparkleIcon
                        isAnimating={generateTitleMutation.isPending}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Regenerate title with AI
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ) : (
            <SidebarMenuButton
              onClick={() => handleSelectConversation(conv.id)}
              isActive={isCurrentConversation}
              className="cursor-pointer flex-1 group-hover/menu-item:bg-sidebar-accent justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 flex-1">
                {showPinIcon && (
                  <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                {(hasRecentlyGeneratedTitle || isRegenerating) && (
                  <AISparkleIcon isAnimating />
                )}
                {isRegenerating ? (
                  <span className="text-muted-foreground text-sm truncate">
                    Generating...
                  </span>
                ) : hasRecentlyGeneratedTitle ? (
                  <span className="truncate">
                    <TypingText
                      text={
                        displayTitle.length > MAX_TITLE_LENGTH
                          ? `${displayTitle.slice(0, MAX_TITLE_LENGTH)}...`
                          : displayTitle
                      }
                      typingSpeed={35}
                      showCursor
                      cursorClassName="bg-primary"
                    />
                  </span>
                ) : (
                  <TruncatedText
                    message={displayTitle}
                    maxLength={MAX_TITLE_LENGTH}
                    className="truncate"
                    showTooltip={false}
                  />
                )}
              </span>
              {(canUpdateConversation || canDeleteConversation) && (
                <DropdownMenu
                  open={isMenuOpen}
                  onOpenChange={(open) => setOpenMenuId(open ? conv.id : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <MoreHorizontal
                      className={cn(
                        "h-4 w-4 p-0 shrink-0 transition-opacity",
                        isMenuOpen
                          ? "opacity-100"
                          : "opacity-0 group-hover/menu-item:opacity-100",
                      )}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    {canUpdateConversation && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePin(conv.id, isPinned);
                          }}
                        >
                          {isPinned ? (
                            <>
                              <PinOff className="h-4 w-4 mr-2" />
                              Unpin
                            </>
                          ) : (
                            <>
                              <Pin className="h-4 w-4 mr-2" />
                              Pin
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(conv.id, displayTitle);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegenerateTitle(conv.id);
                          }}
                          disabled={generateTitleMutation.isPending}
                        >
                          <Sparkles className="h-4 w-4 mr-2" />
                          Regenerate title
                        </DropdownMenuItem>
                      </>
                    )}
                    {canDeleteConversation && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(conv.id);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </SidebarMenuButton>
          )}
        </div>
      </SidebarMenuItem>
    );
  };

  return (
    <SidebarGroup className="px-4 py-0 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="w-full justify-between pr-0">
        Recent Chats
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarGroupAction
                onClick={openConversationSearch}
                className="relative top-auto right-auto transform-none h-6 w-6 text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <Search className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="sr-only">Search conversations</span>
              </SidebarGroupAction>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              Search conversations
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </SidebarGroupLabel>

      <SidebarGroupContent>
        <SidebarMenu>
          {isLoading ? (
            <SidebarMenuItem>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <div className="h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                <span className="text-xs text-muted-foreground">
                  Loading chats...
                </span>
              </div>
            </SidebarMenuItem>
          ) : conversations.length === 0 ? (
            <SidebarMenuItem>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No chats yet
              </div>
            </SidebarMenuItem>
          ) : showExpandedView ? (
            <>
              {/* Expanded view: pinned chats + all unpinned with show more */}
              {pinnedChats.length > 0 && (
                <>
                  {pinnedChats.map((conv) =>
                    renderConversationItem(conv, true),
                  )}
                  {visibleUnpinnedChats.length > 0 && (
                    <div className="my-1 border-t border-border/50" />
                  )}
                </>
              )}
              {visibleUnpinnedChats.map((conv) => renderConversationItem(conv))}
              {hiddenChatsCount > 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setShowAllChats(!showAllChats)}
                    className="cursor-pointer text-xs text-muted-foreground justify-start"
                  >
                    <ChevronDown className="h-3 w-3" />
                    <span>Show less</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </>
          ) : (
            <>
              {/* Default view: pinned (up to 3) + recent unpinned (up to 3) */}
              {pinnedChats.map((conv) => renderConversationItem(conv, true))}
              {pinnedChats.length > 0 && recentUnpinnedChats.length > 0 && (
                <div className="my-1 border-t border-border/50" />
              )}
              {recentUnpinnedChats.map((conv) => renderConversationItem(conv))}
              {allUnpinnedChats.length > RECENT_UNPINNED_COUNT && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setShowAllChats(true)}
                    className="cursor-pointer text-xs text-muted-foreground justify-start"
                  >
                    <ChevronRight className="h-3 w-3" />
                    <span>
                      Show {allUnpinnedChats.length - RECENT_UNPINNED_COUNT}{" "}
                      more
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </>
          )}
        </SidebarMenu>
      </SidebarGroupContent>

      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              conversation and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteConversationMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteConfirmId) {
                  await handleDeleteConversation(deleteConfirmId);
                  setDeleteConfirmId(null); // Close dialog only after successful deletion
                }
              }}
              disabled={deleteConversationMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConversationMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarGroup>
  );
}
