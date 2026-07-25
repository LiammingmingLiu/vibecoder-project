-- 游搭 YooDa · 初始建表（对应 docs/demo-plan.html §6）
-- Demo 阶段 RLS 全部关闭（宽松模式换开发速度），正式版必须收紧。

create table profiles (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  gender text default 'secret',          -- male | female | secret
  voice_tag text,                        -- 低音炮/少年音/御姐音/甜妹音/不开麦
  games jsonb default '[]',              -- [{"name":"三角洲行动","roles":["突击"],"rank":"钻石"}]
  play_style text,                       -- 激进/稳健/娱乐
  active_hours text[] default '{}',      -- {下午,晚间,深夜,周末}
  mbti text,
  intro text,                            -- 自我介绍原话（NL onboarding 输入 / bot 人设）
  is_bot boolean default false,
  last_seen_at timestamptz default now(),
  created_at timestamptz default now()
);

create table match_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references profiles(id),
  raw_text text not null,
  parsed jsonb,
  excluded_ids uuid[] default '{}',
  created_at timestamptz default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references match_requests(id),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  reason text not null,
  score numeric,
  created_at timestamptz default now()
);

create table messages (
  id bigint generated always as identity primary key,
  match_id uuid references matches(id),
  sender_id uuid references profiles(id),
  content text not null,
  created_at timestamptz default now()
);

create index on messages (match_id, id);
create index on profiles (is_bot, last_seen_at desc);

-- 聊天实时订阅
alter publication supabase_realtime add table messages;
