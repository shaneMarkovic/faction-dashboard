"use client";

import { type ReactNode, useState } from "react";
import type { UIMessage } from "ai";
import { FlyingChat } from "./FlyingChat";
import { getAiChat, listAiChats } from "@/app/(dash)/finance/ai-actions";
import type { AiChatSummary } from "@/lib/ai/chat-store";

/**
 * Houses the AI co-pilot. Desktop: sticky right sidebar. Mobile: floating button
 * → bottom drawer. A gear swaps the chat for provider/key settings. Owns chat
 * session state — "New" starts a fresh conversation, the dropdown resumes a past
 * one — and remounts FlyingChat (via key) so each session is a clean useChat.
 */
export function CoPilotDock({
  settings,
  configured,
  initialChats,
  collapsed,
  onCollapse,
}: {
  settings: ReactNode;
  configured: boolean;
  initialChats: AiChatSummary[];
  /** Desktop-only: hidden when true (the launcher lives in FlyingWorkspace). */
  collapsed: boolean;
  onCollapse: () => void;
}) {
  const [open, setOpen] = useState(false); // mobile drawer
  const [showSettings, setShowSettings] = useState(!configured);
  const [chats, setChats] = useState<AiChatSummary[]>(initialChats);

  // `key` forces a fresh useChat on session switch; `id`/`initial` seed it.
  const [view, setView] = useState<{ key: number; id?: string; initial?: UIMessage[] }>({ key: 0 });

  const refreshChats = () => void listAiChats().then(setChats);
  const newChat = () => setView((v) => ({ key: v.key + 1, id: undefined, initial: undefined }));
  const openChat = (id: string) =>
    void getAiChat(id).then((messages) => setView((v) => ({ key: v.key + 1, id, initial: messages })));

  return (
    <>
      <aside
        className={[
          open ? "fixed inset-x-2 bottom-2 top-16 z-40 flex flex-col" : "hidden",
          collapsed
            ? "lg:hidden"
            : "lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col lg:self-start",
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
              <button
                type="button"
                onClick={onCollapse}
                title="Hide co-pilot"
                aria-label="Hide co-pilot"
                className="hidden rounded-md px-2 py-1 text-sm hover:text-foreground lg:inline"
              >
                ⟩
              </button>
            </div>
          </header>

          {!showSettings && configured && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
              <button
                type="button"
                onClick={newChat}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-muted hover:text-foreground"
              >
                ＋ New
              </button>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) openChat(e.target.value);
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-foreground outline-none"
                aria-label="Resume a past chat"
              >
                <option value="">Resume a chat… ({chats.length})</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col p-4">
            {showSettings ? (
              <div className="overflow-y-auto">{settings}</div>
            ) : (
              <FlyingChat
                key={view.key}
                configured={configured}
                chatId={view.id}
                initialMessages={view.initial}
                onTurnFinish={refreshChats}
              />
            )}
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
