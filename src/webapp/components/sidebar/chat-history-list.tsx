import { Trash2 } from "lucide-react";
import { groupByRecency } from "@/lib/chat/storage";
import type { ChatSession } from "@/lib/chat/types";

export function ChatHistoryList({
  sessions,
  activeId,
  onSelect,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const groups = groupByRecency(sessions);

  if (groups.length === 0) {
    return <p className="px-2 py-4 text-xs text-muted">No chats yet.</p>;
  }

  return (
    <nav aria-label="Chat history" className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-2 pb-1 text-[11px] uppercase tracking-[0.12em] text-muted">{group.label}</div>
          <ul className="flex flex-col gap-0.5">
            {group.sessions.map((s) => (
              <li key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    s.id === activeId ? "bg-lavender/60 text-ink" : "text-muted hover:bg-peach/40 hover:text-ink"
                  }`}
                >
                  {s.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete chat: ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-sm p-1 text-muted hover:text-verified-red group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
