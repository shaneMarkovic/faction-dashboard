"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { resetTravelCapacityAuto, setTravelCapacity, setTravelTimeReduction } from "@/app/(dash)/finance/actions";
import { type FlyingSortKey, type FlyingView, setFlyingView } from "@/lib/flying-view";

const SUGGESTIONS = [
  "What's my best run right now?",
  "Show only runs over 70% odds",
  "Sort by trip profit and focus on Mexico",
  "Where is my money going lately?",
];

/** Pretty label for a tool part type like "tool-get_flying_opportunities". */
function toolLabel(type: string): string {
  return type.replace(/^tool-/, "").replace(/_/g, " ");
}

export function FlyingChat({ configured }: { configured: boolean }) {
  const [input, setInput] = useState("");
  const router = useRouter();

  const { messages, sendMessage, addToolOutput, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/finance-chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // Client-side tools: apply view changes to the shared store, and route
    // persisted prefs through the existing server actions. Don't await
    // addToolOutput (avoids the documented deadlock).
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;

      switch (toolCall.toolName) {
        case "set_table_filter": {
          const i = toolCall.input as { country?: string; under5h?: boolean; minOdds?: number };
          const patch: Partial<FlyingView> = {};
          if (i.country !== undefined) patch.country = i.country || "all";
          if (i.under5h !== undefined) patch.under5h = i.under5h;
          if (i.minOdds !== undefined) patch.minOdds = i.minOdds;
          setFlyingView(patch);
          addToolOutput({ tool: "set_table_filter", toolCallId: toolCall.toolCallId, output: patch });
          break;
        }
        case "set_table_sort": {
          const i = toolCall.input as { sortBy: FlyingSortKey; ascending?: boolean };
          const applied = { sort: i.sortBy, asc: i.ascending ?? false };
          setFlyingView(applied);
          addToolOutput({ tool: "set_table_sort", toolCallId: toolCall.toolCallId, output: applied });
          break;
        }
        case "set_capacity": {
          const i = toolCall.input as { value: number | "auto" };
          if (i.value === "auto") await resetTravelCapacityAuto();
          else await setTravelCapacity(i.value);
          router.refresh();
          addToolOutput({ tool: "set_capacity", toolCallId: toolCall.toolCallId, output: { capacity: i.value } });
          break;
        }
        case "set_time_reduction": {
          const i = toolCall.input as { percent: number };
          await setTravelTimeReduction(i.percent);
          router.refresh();
          addToolOutput({ tool: "set_time_reduction", toolCallId: toolCall.toolCallId, output: { percent: i.percent } });
          break;
        }
      }
    },
  });

  if (!configured) {
    return (
      <p className="text-sm text-muted">
        Tap the ⚙ above to add your AI provider and key. The co-pilot reads your
        flying opportunities and your own Torn finance data, and can filter or
        sort the table for you.
      </p>
    );
  }

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded-2xl bg-surface-2 px-3 py-2 text-sm"
                  : "inline-block max-w-full rounded-2xl bg-surface px-3 py-2 text-sm"
              }
            >
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <span key={i} className="whitespace-pre-wrap">{part.text}</span>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  return (
                    <span
                      key={i}
                      className="mr-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
                      title="Read your data / adjusted the table"
                    >
                      🔧 {toolLabel(part.type)}
                    </span>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {status === "submitted" && <div className="text-xs text-muted">thinking…</div>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-[#f85149]">
          {error.message || "Something went wrong — try again."}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about runs, odds, your finances — or say 'filter to Japan'…"
          aria-label="Message the co-pilot"
          className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-[#22c48a] px-4 py-2 text-sm font-semibold text-[#0f0f0f] disabled:opacity-60"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
