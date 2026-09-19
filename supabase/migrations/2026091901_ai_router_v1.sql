create extension if not exists pgcrypto;

create table if not exists public.ai_router_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id text not null unique,
  mode text not null check (mode in ('preview', 'count', 'execute')),
  profile text,
  task_type text,
  complexity numeric,
  risk numeric,
  provider text,
  model text,
  reasoning_effort text,
  input_tokens_estimated integer,
  input_tokens_actual integer,
  output_p50 integer,
  output_p90 integer,
  output_tokens_actual integer,
  reasoning_tokens_actual integer,
  estimated_cost_usd numeric,
  actual_cost_usd numeric,
  latency_ms integer,
  success boolean not null default true,
  error text
);

create index if not exists ai_router_requests_created_at_idx on public.ai_router_requests (created_at desc);
create index if not exists ai_router_requests_task_model_idx on public.ai_router_requests (task_type, provider, model);

alter table public.ai_router_requests enable row level security;

comment on table public.ai_router_requests is
  'Server-written telemetry for AI Router calibration. No client RLS policies are created by default.';
