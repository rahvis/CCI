"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/chat/types";

export function MessageList({ messages, streamingId }: { messages: ChatMessage[]; streamingId: string | null }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <p className="text-lg font-medium text-ink">Ask Gemma something</p>
        <p className="max-w-sm text-sm">
          Every response is signed inside the AMD SEV-SNP enclave and scored with a real conformal-prediction
          confidence bound — both are shown alongside the answer.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-8">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} streaming={m.id === streamingId} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
