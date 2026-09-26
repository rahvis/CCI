import { HipaaEnclaveBadge } from "@/components/confidential/hipaa-enclave-badge";
import { ClinicalConfidence } from "@/components/conformal/clinical-confidence";
import { DifferentialSet } from "@/components/conformal/differential-set";
import { EscalateCard } from "@/components/conformal/escalate-card";
import type { ChatMessage } from "@/lib/chat/types";

export function MessageBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-lg bg-ink px-4 py-2.5 text-[15px] text-paper shadow-softer">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.error) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[75%] rounded-lg border border-verified-red/30 bg-verified-red-bg px-4 py-2.5 text-[15px] text-verified-red">
          {message.error}
        </div>
      </div>
    );
  }

  const cp = message.conformalPrediction;
  const inSetCount = cp?.prediction_set.filter((e) => e.in_set).length ?? -1;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        <div className="rounded-lg border border-hairline bg-paper-cool px-4 py-2.5 text-[15px] text-ink shadow-softer">
          {message.content}
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-teal/60 align-middle" />}
        </div>

        {cp && (
          <>
            {cp.abstain ? (
              <EscalateCard cp={cp} />
            ) : inSetCount > 1 ? (
              <DifferentialSet cp={cp} />
            ) : (
              <ClinicalConfidence cp={cp} />
            )}
          </>
        )}

        {message.confidentialProof !== undefined && !streaming && (
          <HipaaEnclaveBadge
            content={message.content}
            proof={message.confidentialProof ?? null}
            conformal={cp}
          />
        )}
      </div>
    </div>
  );
}
