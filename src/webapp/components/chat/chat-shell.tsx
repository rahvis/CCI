"use client";

import { useEffect, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { AppSidebar, SidebarBody } from "@/components/sidebar/app-sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MessageList } from "@/components/chat/message-list";
import { Composer } from "@/components/chat/composer";
import { streamChat } from "@/lib/chat/use-chat-stream";
import {
  loadSessions,
  saveSessions,
  upsertSession,
  deleteSession as removeSession,
  patchMessage,
  titleFromFirstMessage,
} from "@/lib/chat/storage";
import { uuid } from "@/lib/uuid";
import type { ChatMessage, ChatSession } from "@/lib/chat/types";

const SIDEBAR_COOKIE = "sidebar_state";

function setSidebarCookie(collapsed: boolean) {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000`;
}

export function ChatShell({ initialSidebarCollapsed }: { initialSidebarCollapsed: boolean }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSessions(loadSessions());
    setHydrated(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => {
          setSidebarCookie(!c);
          return !c;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      setSidebarCookie(!c);
      return !c;
    });
  }, []);

  const newChat = useCallback(() => {
    setActiveSessionId(null);
    setMobileOpen(false);
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setMobileOpen(false);
  }, []);

  const onDeleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = removeSession(prev, id);
        saveSessions(next);
        return next;
      });
      if (activeSessionId === id) setActiveSessionId(null);
    },
    [activeSessionId],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Session-level e-process, derived from the per-turn e-values already carried
  // in the signed proof blocks. Merged by arithmetic mean, which is the only
  // rule valid under this system's dependence structure: the per-turn values
  // share one frozen calibration set, so the running product is not a test
  // martingale here. See lib/conformal/evalue.ts.
  const eProcess = (() => {
    const es = (activeSession?.messages ?? [])
      .map((m) => m.conformalPrediction?.e_value)
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    if (es.length === 0) return undefined;
    const meanE = es.reduce((a, e) => a + e.e_value, 0) / es.length;
    const maxAttainableE = es[es.length - 1].e_max_attainable;
    return { turns: es.length, meanE, maxAttainableE, alarmFired: meanE >= 10 };
  })();

  const sendMessage = useCallback(
    async (text: string) => {
      if (streamingId) return;

      const now = Date.now();
      const base: ChatSession =
        activeSession ?? { id: uuid(), title: titleFromFirstMessage(text), createdAt: now, updatedAt: now, messages: [] };

      const historyForApi = base.messages.map((m) => ({ role: m.role, content: m.content }));

      const userMsg: ChatMessage = { id: uuid(), role: "user", content: text, createdAt: now };
      const assistantId = uuid();
      const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "", createdAt: now };

      let working: ChatSession = {
        ...base,
        title: base.messages.length === 0 ? titleFromFirstMessage(text) : base.title,
        updatedAt: now,
        messages: [...base.messages, userMsg, assistantMsg],
      };

      setSessions((prev) => upsertSession(prev, working));
      setActiveSessionId(working.id);
      setStreamingId(assistantId);

      let accumulated = "";
      try {
        for await (const ev of streamChat(text, historyForApi)) {
          if (ev.type === "token") {
            accumulated += ev.text;
            working = patchMessage(working, assistantId, { content: accumulated });
            setSessions((prev) => upsertSession(prev, working));
          } else if (ev.type === "proof") {
            working = patchMessage(working, assistantId, {
              conformalPrediction: ev.conformalPrediction,
              confidentialProof: ev.confidentialProof ?? undefined,
            });
            setSessions((prev) => upsertSession(prev, working));
          } else if (ev.type === "error") {
            working = patchMessage(working, assistantId, { error: ev.error });
            setSessions((prev) => upsertSession(prev, working));
          }
          // "done" carries only timing metadata — nothing to patch onto the message.
        }
      } finally {
        setStreamingId(null);
        setSessions((prev) => {
          const next = upsertSession(prev, working);
          saveSessions(next);
          return next;
        });
      }
    },
    [activeSession, streamingId],
  );

  const sidebarProps = {
    collapsed,
    sessions,
    activeId: activeSessionId,
    onSelect: selectSession,
    onDelete: onDeleteSession,
    onNewChat: newChat,
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper">
      <AppSidebar {...sidebarProps} onToggleCollapse={toggleCollapse} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent>
          <SidebarBody {...sidebarProps} collapsed={false} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button type="button" aria-label="Open chat history" className="rounded-sm p-1.5 text-ink">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
          </Sheet>
          <span className="truncate text-sm font-semibold text-ink">Conformal Confidential Inference</span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {hydrated && <MessageList messages={activeSession?.messages ?? []} streamingId={streamingId} />}
        </div>
        <Composer onSend={sendMessage} disabled={streamingId !== null} eProcess={eProcess} />
      </div>
    </div>
  );
}
