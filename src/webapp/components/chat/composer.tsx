"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FooterStatusPill } from "@/components/confidential/footer-status-pill";

export function Composer({
  onSend,
  disabled,
  eProcess,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  eProcess?: { turns: number; meanE: number; maxAttainableE: number; alarmFired: boolean };
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-hairline bg-paper px-4 py-3 sm:px-8">
      <div className="flex items-end gap-2 rounded-lg border border-hairline bg-paper-cool p-2 shadow-softer">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Gemma something…"
          rows={1}
          className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink placeholder:text-muted focus:outline-none"
        />
        <Button size="icon" variant="coral" onClick={submit} disabled={disabled || !value.trim()}>
          <ArrowUp className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          CPU-only inference inside the enclave (no AVX512, float32) runs at ~4 tokens/sec — replies stream in
          slowly. That is the cost of keeping the model in encrypted memory.
        </span>
        <FooterStatusPill eProcess={eProcess} />
      </div>
    </div>
  );
}
