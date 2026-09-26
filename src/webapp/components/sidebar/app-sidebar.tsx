import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NewChatButton } from "@/components/sidebar/new-chat-button";
import { ChatHistoryList } from "@/components/sidebar/chat-history-list";
import type { ChatSession } from "@/lib/chat/types";

interface SidebarBodyProps {
  collapsed: boolean;
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}

export function SidebarBody({ collapsed, sessions, activeId, onSelect, onDelete, onNewChat }: SidebarBodyProps) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 px-1 py-1">
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight text-ink">Conformal Confidential Inference</span>
        )}
      </div>
      <NewChatButton onClick={onNewChat} collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!collapsed && (
          <ChatHistoryList sessions={sessions} activeId={activeId} onSelect={onSelect} onDelete={onDelete} />
        )}
      </div>
      {!collapsed && (
        <div className="border-t border-hairline pt-2 text-xs text-muted">Gemma-1B · vLLM · Azure SEV-SNP CVM</div>
      )}
    </div>
  );
}

export function AppSidebar(
  props: SidebarBodyProps & { onToggleCollapse: () => void },
) {
  return (
    <aside
      className={`hidden shrink-0 border-r border-hairline bg-paper-cool transition-[width] duration-150 md:flex ${
        props.collapsed ? "w-[72px]" : "w-[280px]"
      }`}
    >
      <div className="flex w-full flex-col">
        <div className="flex justify-end px-2 pt-2">
          <button
            type="button"
            onClick={props.onToggleCollapse}
            aria-label={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-sm p-1.5 text-muted hover:bg-peach/50 hover:text-ink"
            title="Toggle sidebar (⌘/Ctrl+B)"
          >
            {props.collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <SidebarBody {...props} />
      </div>
    </aside>
  );
}
