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

  // Each chat has a stable client-generated id so useChat keeps its messages
  // across re-renders (e.g. when the session list refreshes after a turn) and
  // the server persists under that same id. `key` forces a fresh useChat on
  // switch; `initial` seeds a resumed conversation.
  const [view, setView] = useState<{ key: number; id: string; initial: UIMessage[] }>(() => ({
    key: 0,
    id: crypto.randomUUID(),
    initial: [],
  }));

  const refreshChats = () => void listAiChats().then(setChats);
  const newChat = () => setView((v) => ({ key: v.key + 1, id: crypto.randomUUID(), initial: [] }));
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
        <div className="xp-window flex min-h-0 flex-1 flex-col shadow-lg lg:shadow-none">
          <header className="xp-titlebar mb-px">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">🤖 AI co-pilot</span>
              {!configured && (
                <span className="bevel-in bg-surface px-1 text-[10px] font-bold uppercase tracking-wide text-[#b8860b] [text-shadow:none]">
                  setup needed
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                title={showSettings ? "Back to chat" : "Provider & key settings"}
                aria-label={showSettings ? "Back to chat" : "Provider & key settings"}
                className="xp-caption-btn"
              >
                {showSettings ? "💬 Chat" : "⚙ Settings"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close co-pilot"
                aria-label="Close co-pilot"
                className="xp-caption-btn xp-caption-btn--close lg:hidden"
              >
                ✕
              </button>
              <button
                type="button"
                onClick={onCollapse}
                title="Hide the co-pilot panel"
                aria-label="Hide co-pilot"
                className="hidden xp-caption-btn lg:inline-flex"
              >
                Hide ▶
              </button>
            </span>
          </header>

          {!showSettings && configured && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
              <button
                type="button"
                onClick={newChat}
                className="xp-toggle shrink-0"
              >
                ＋ New
              </button>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) openChat(e.target.value);
                }}
                className="xp-field min-w-0 flex-1"
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
          className="fixed bottom-4 right-4 z-30 xp-btn lg:hidden"
        >
          💬 Open co-pilot
        </button>
      )}
    </>
  );
}
