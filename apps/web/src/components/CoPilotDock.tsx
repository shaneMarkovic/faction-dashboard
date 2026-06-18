"use client";

import { type ReactNode, useState } from "react";

/**
 * Houses the AI co-pilot. On desktop it's a sticky right-hand sidebar that stays
 * in view while you scroll the opportunities; on mobile it collapses to a
 * floating button that opens a bottom drawer. A gear swaps the chat for the
 * provider/key settings. The chat is rendered exactly once (single useChat).
 */
export function CoPilotDock({
  chat,
  settings,
  configured,
}: {
  chat: ReactNode;
  settings: ReactNode;
  configured: boolean;
}) {
  const [open, setOpen] = useState(false); // mobile drawer
  const [showSettings, setShowSettings] = useState(!configured);

  return (
    <>
      <aside
        className={[
          // Mobile: hidden until opened, then a bottom drawer.
          open ? "fixed inset-x-2 bottom-2 top-16 z-40 flex flex-col" : "hidden",
          // Desktop: sticky sidebar that fills the viewport height.
          "lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col lg:self-start",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-surface shadow-lg lg:shadow-none">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">🤖 AI co-pilot</span>
              {!configured && (
                <span className="rounded-full bg-[#d29922]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#d29922]">
                  setup needed
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-muted">
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                title={showSettings ? "Back to chat" : "Provider & key settings"}
                aria-label={showSettings ? "Back to chat" : "Provider & key settings"}
                className="rounded-md px-2 py-1 text-sm hover:text-foreground"
              >
                {showSettings ? "💬" : "⚙"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close co-pilot"
                className="rounded-md px-2 py-1 text-sm hover:text-foreground lg:hidden"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col p-4">
            {showSettings ? <div className="overflow-y-auto">{settings}</div> : chat}
          </div>
        </div>
      </aside>

      {/* Mobile launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-30 rounded-full bg-[#22c48a] px-4 py-3 text-sm font-semibold text-[#0f0f0f] shadow-lg lg:hidden"
        >
          💬 Co-pilot
        </button>
      )}
    </>
  );
}
