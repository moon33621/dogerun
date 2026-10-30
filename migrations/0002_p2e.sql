-- Play-to-earn: checked runs, payout vouchers, wallet sign-in nonces.
-- Amounts are tenths of $DRUN (200 $DRUN = 2000 tenths) so the books stay integers.

create table if not exists game_runs (
  id text primary key,
  user_id text not null,
  player_name text not null,
  wallet text not null default '',
  score integer not null,
  dist integer not null,
  coins integer not null,
  bones integer not null,
  tricks integer not null,
  duration_ms integer not null,
  reward_tenths integer not null,
  created_at timestamptz not null default now()
);

create index if not exists game_runs_score_idx on game_runs (score desc);
create index if not exists game_runs_user_idx on game_runs (user_id, created_at desc);

create table if not exists user_balance (
  user_id text primary key,
  unclaimed_tenths integer not null default 0
);

create table if not exists user_earn_day (
  user_id text not null,
  day text not null,
  earned_tenths integer not null default 0,
  primary key (user_id, day)
);

create table if not exists treasury_day (
  day text primary key,
  spent_tenths integer not null default 0
);

create table if not exists payout_claims (
  id text primary key,
  user_id text not null,
  wallet text not null,
  tenths integer not null,
  amount_wei text not null,
  nonce text not null,
  deadline integer not null,
  signature text not null,
  calldata text not null,
  contract text not null,
  status text not null,
  day text not null,
  created_at timestamptz not null default now()
);

create index if not exists payout_claims_user_idx on payout_claims (user_id, status);

create table if not exists user_wallets (
  user_id text primary key,
  address text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists wallet_nonces (
  address text primary key,
  message text not null,
  expires_at timestamptz not null
);
