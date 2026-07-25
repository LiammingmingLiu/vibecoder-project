-- v3：真人化 + 账号体系 + 会话管理
delete from messages; delete from matches; delete from match_requests;
delete from profiles where is_bot = true;  -- bot 全面下场

alter table profiles add column if not exists auth_id uuid unique;
alter table matches
  add column if not exists a_deleted boolean default false,
  add column if not exists b_deleted boolean default false,
  add column if not exists a_read_id bigint default 0,
  add column if not exists b_read_id bigint default 0,
  add column if not exists last_msg_at timestamptz default now();
create unique index if not exists matches_pair_uniq
  on matches (least(user_a, user_b), greatest(user_a, user_b));

create table if not exists blocks (
  blocker uuid references profiles(id),
  blocked uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (blocker, blocked)
);

-- anon key 即将进浏览器（仅用于 /auth）：所有业务表开 RLS 且不建策略 = PostgREST 对 anon 全拒，service role 不受影响
alter table profiles enable row level security;
alter table match_requests enable row level security;
alter table matches enable row level security;
alter table messages enable row level security;
alter table blocks enable row level security;

insert into supabase_migrations.schema_migrations(version, name, statements)
  values ('20260725210000','real_users', array['via management api']) on conflict do nothing;
