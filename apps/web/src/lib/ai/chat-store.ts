/**
 * Persistence for Flying Co-Pilot chat sessions. Server-only. memberId is always
 * supplied by the caller from the verified session (never the client), so every
 * read/write is scoped to the owner.
 *
 * See docs/flying-copilot-design.md (sessions follow-up).
 */

import "server-only";
import type { UIMessage } from "ai";
import { tryQuery } from "@/lib/db";

export interface AiChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Derive a short title from the first user message. */
function titleFrom(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text =
    firstUser?.parts.find((p): p is { type: "text"; text: string } => p.type === "text")?.text ?? "";
  const t = text.trim().replace(/\s+/g, " ").slice(0, 60);
  return t || "New chat";
}

export async function saveAiChat(memberId: number, chatId: string, messages: UIMessage[]): Promise<void> {
  await tryQuery(
    `insert into ai_chat (member_id, chat_id, title, messages, updated_at)
     values ($1, $2, $3, $4::jsonb, now())
     on conflict (member_id, chat_id) do update
       set messages = excluded.messages, title = excluded.title, updated_at = now()`,
    [memberId, chatId, titleFrom(messages), JSON.stringify(messages)],
  );
}

export async function loadAiChat(memberId: number, chatId: string): Promise<UIMessage[]> {
  const rows = await tryQuery<{ messages: UIMessage[] }>(
    "select messages from ai_chat where member_id = $1 and chat_id = $2",
    [memberId, chatId],
  );
  return rows?.[0]?.messages ?? [];
}

export async function listAiChatsFor(memberId: number): Promise<AiChatSummary[]> {
  const rows = await tryQuery<{ chat_id: string; title: string; updated_at: string }>(
    "select chat_id, title, updated_at from ai_chat where member_id = $1 order by updated_at desc limit 30",
    [memberId],
  );
  return (rows ?? []).map((r) => ({ id: r.chat_id, title: r.title, updatedAt: r.updated_at }));
}

export async function deleteAiChatFor(memberId: number, chatId: string): Promise<void> {
  await tryQuery("delete from ai_chat where member_id = $1 and chat_id = $2", [memberId, chatId]);
}
