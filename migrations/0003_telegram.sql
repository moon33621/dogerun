-- Telegram bot: linked chats, one-time connect codes, and withdrawal requests.

create table if not exists telegram_links (
  user_id text primary key,
  chat_id text not null unique,
  username text,
  linked_at timestamptz not null default now()
);

create table if not exists telegram_link_codes (
  code text primary key,
  user_id text not null,
  expires_at timestamptz not null
);

create table if not exists withdrawal_requests (
  id text primary key,
  user_id text not null,
  wallet text not null,
  tenths integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists withdrawal_one_pending_idx
  on withdrawal_requests (user_id)
  where status = 'pending';

