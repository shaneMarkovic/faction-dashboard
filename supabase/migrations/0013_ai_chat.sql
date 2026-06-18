-- Flying Co-Pilot: persisted chat sessions (per member), so users can start new
-- conversations and resume previous ones. `messages` holds the AI SDK UIMessage[]
-- for the conversation as JSONB. RLS enabled with no policies — service-role
-- reads only, mirroring 0009_rls_finance.sql.

create table ai_chat (
  member_id  bigint not null,
  chat_id    text not null,
  title      text not null default 'New chat',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, chat_id)
);

create index ai_chat_member_recent on ai_chat (member_id, updated_at desc);

alter table ai_chat enable row level security;
