-- ─────────────────────────────────────────────────────────────────────────────
-- ASR 日用量计数器 —— 云端转写的成本硬上限
--
-- 在 Supabase 控制台的 SQL Editor 里执行一次。
-- 不执行的后果：ASR_PROVIDER 为付费供应商时，/api/transcribe 会 fail closed
-- （拒绝升级、保留浏览器初稿），而不是无上限地花钱。这是刻意的。
--
-- 为什么不复用内存里的 rateLimit：它冷启动即重置、serverless 每实例一份，
-- 对一个按音频秒数计费的路由，那是尽力而为，不是上限。
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.asr_usage (
  day     date   primary key,
  seconds bigint not null default 0
);

comment on table public.asr_usage is
  '云端 ASR 每日已消耗的音频秒数。供 /api/transcribe 做成本硬上限。';

-- RLS 打开且不建任何 policy：只有 service-role key 能读写（它绕过 RLS），
-- 而该 key 只在服务端 API 路由里使用，绝不进客户端包。
alter table public.asr_usage enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 原子递增并返回当日新总数。
--
-- 必须是一个函数而不是「先 select 再 update」：并发请求下读改写会互相覆盖，
-- 而这里少算的每一秒都是真金白银。upsert + returning 让递增与读取在同一条
-- 语句里完成。
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.asr_usage_add(p_day date, p_seconds int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  insert into public.asr_usage (day, seconds)
  values (p_day, p_seconds)
  on conflict (day) do update
    set seconds = public.asr_usage.seconds + excluded.seconds
  returning seconds into total;
  return total;
end;
$$;

comment on function public.asr_usage_add is
  '原子地把 p_seconds 计入 p_day 并返回当日新总数。';

-- 可选：想看用量时
--   select * from public.asr_usage order by day desc limit 30;
