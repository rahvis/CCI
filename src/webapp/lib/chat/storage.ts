"use client";

import type { ChatMessage, ChatSession } from "@/lib/chat/types";

// All chat content lives in the browser only — the server never persists a
// single byte of message content (see lib/crypto/session-key.ts's per-
// message signing, which reads straight from the in-flight response and
// stores nothing). This is a deliberate property for a PHI-adjacent demo,
// not just a minimalism shortcut.
const STORAGE_KEY = "cci-chat-sessions";

function safeParse(json: string | null): ChatSession[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded situations —
    // the chat still works for the current tab session, it just won't persist.
  }
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx === -1) return [session, ...sessions];
  const next = [...sessions];
  next[idx] = session;
  return next;
}

export function deleteSession(sessions: ChatSession[], id: string): ChatSession[] {
  return sessions.filter((s) => s.id !== id);
}

export function patchMessage(
  session: ChatSession,
  messageId: string,
  patch: Partial<ChatMessage>,
): ChatSession {
  return {
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  };
}

export function titleFromFirstMessage(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || "New chat";
}

export function groupByRecency(sessions: ChatSession[]): { label: string; sessions: ChatSession[] }[] {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const groups: Record<string, ChatSession[]> = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    Older: [],
  };
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const age = now - s.updatedAt;
    if (age < DAY) groups.Today.push(s);
    else if (age < 2 * DAY) groups.Yesterday.push(s);
    else if (age < 7 * DAY) groups["Last 7 days"].push(s);
    else groups.Older.push(s);
  }
  return Object.entries(groups)
    .filter(([, sess]) => sess.length > 0)
    .map(([label, sess]) => ({ label, sessions: sess }));
}
