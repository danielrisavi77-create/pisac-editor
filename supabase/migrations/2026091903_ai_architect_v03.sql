-- AI Architect v0.3 durable outcome store.
-- Prepared by reconciliation of AI Architect v0.2 and AI Router V2.
-- DO NOT apply automatically to production; validate/review first.

create extension if not exists pgcrypto;

create table if not exists public.ai_architect_requests (
  request_id uuid primary key,
  created_at timestamptz not null default now(),
  project text,
  feature text,
  task_class text not null,
  risk text,
  complexity integer,
  profile text,
  workflow_id text,
  workflow_version text,
  prompt_id text,
  prompt_version text,
  context_tokens_before bigint,
  context_tokens_after bigint,
  prompt_fingerprint text check (prompt_fingerprint is null or length(prompt_fingerprint)=64)
);

create table if not exists public.ai_architect_attempts (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.ai_architect_requests(request_id) on delete cascade,
  attempt_number integer not null,
  attempt_kind text not null check (attempt_kind in ('initial','retry','fallback','escalation')),
  task_class text,
  provider text,
  requested_model text,
  actual_model text,
  reasoning_level text,
  input_token_method text,
  predicted_input_tokens bigint,
  actual_input_tokens bigint,
  predicted_output_p50 bigint,
  predicted_output_p90 bigint,
  predicted_output_p95 bigint,
  predicted_reasoning_p90 bigint,
  actual_output_tokens bigint,
  actual_visible_output_tokens bigint,
  actual_reasoning_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  predicted_cost_usd numeric,
  predicted_budget_ceiling_usd numeric,
  actual_cost_usd numeric,
  actual_cost_status text,
  latency_ms bigint,
  contract_passed boolean,
  success boolean not null default false,
  error_type text,
  transient_error boolean,
  created_at timestamptz not null default now(),
  unique(request_id,attempt_number)
);

create table if not exists public.ai_architect_verifications (
  verification_id uuid primary key,
  request_id uuid not null references public.ai_architect_requests(request_id) on delete cascade,
  parent_attempt_number integer,
  provider text,
  requested_model text,
  actual_model text,
  same_actual_model boolean not null default false,
  passed boolean not null default false,
  verdict text,
  malformed boolean not null default false,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  actual_cost_usd numeric,
  actual_cost_status text,
  latency_ms bigint,
  error_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_architect_results (
  request_id uuid primary key references public.ai_architect_requests(request_id) on delete cascade,
  created_at timestamptz not null default now(),
  project text,
  feature text,
  task_class text not null,
  provider text,
  requested_model text,
  actual_model text,
  reasoning_level text,
  total_actual_cost_usd numeric,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_tokens bigint,
  total_latency_ms bigint,
  retry_count integer not null default 0,
  fallback_count integer not null default 0,
  escalation_count integer not null default 0,
  first_pass_success boolean not null default false,
  final_verified_success boolean not null default false,
  quality_score numeric check (quality_score is null or (quality_score>=0 and quality_score<=1)),
  failure_class text
);

alter table public.ai_architect_requests enable row level security;
alter table public.ai_architect_attempts enable row level security;
alter table public.ai_architect_verifications enable row level security;
alter table public.ai_architect_results enable row level security;

revoke all on public.ai_architect_requests from anon, authenticated;
revoke all on public.ai_architect_attempts from anon, authenticated;
revoke all on public.ai_architect_verifications from anon, authenticated;
revoke all on public.ai_architect_results from anon, authenticated;

grant select,insert,update,delete on public.ai_architect_requests to service_role;
grant select,insert,update,delete on public.ai_architect_attempts to service_role;
grant select,insert,update,delete on public.ai_architect_verifications to service_role;
grant select,insert,update,delete on public.ai_architect_results to service_role;

create or replace view public.ai_architect_calibration_stats
with (security_invoker=true)
as
select
  a.task_class,
  a.provider,
  a.requested_model as model,
  coalesce(a.reasoning_level,'provider-default') as reasoning_level,
  count(*)::bigint as sample_count,
  count(r.request_id)::bigint as verified_sample_count,
  percentile_cont(0.5) within group (order by a.actual_visible_output_tokens)
    filter (where a.actual_visible_output_tokens is not null) as output_median,
  percentile_cont(0.9) within group (order by a.actual_visible_output_tokens)
    filter (where a.actual_visible_output_tokens is not null) as output_p90,
  percentile_cont(0.95) within group (order by a.actual_visible_output_tokens)
    filter (where a.actual_visible_output_tokens is not null) as output_p95,
  percentile_cont(0.5) within group (order by a.actual_reasoning_tokens)
    filter (where a.actual_reasoning_tokens is not null) as reasoning_median,
  percentile_cont(0.9) within group (order by a.actual_reasoning_tokens)
    filter (where a.actual_reasoning_tokens is not null) as reasoning_p90,
  percentile_cont(0.95) within group (order by a.actual_reasoning_tokens)
    filter (where a.actual_reasoning_tokens is not null) as reasoning_p95,
  avg((r.final_verified_success is true)::int)::double precision as final_success_rate,
  avg((r.first_pass_success is true)::int)::double precision as first_pass_success_rate,
  avg((r.retry_count>0)::int)::double precision as retry_rate,
  avg((r.fallback_count>0)::int)::double precision as fallback_rate,
  avg((r.escalation_count>0)::int)::double precision as escalation_rate,
  percentile_cont(0.5) within group (order by r.total_latency_ms)
    filter (where r.total_latency_ms is not null) as median_latency_ms,
  case
    when count(*) filter (where r.final_verified_success and r.total_actual_cost_usd is not null)>0
    then sum(r.total_actual_cost_usd) filter (where r.total_actual_cost_usd is not null)
      / count(*) filter (where r.final_verified_success and r.total_actual_cost_usd is not null)
    else null
  end as cost_per_success_usd
from public.ai_architect_attempts a
join public.ai_architect_results r on r.request_id=a.request_id
where a.attempt_kind='initial'
group by a.task_class,a.provider,a.requested_model,coalesce(a.reasoning_level,'provider-default');

create or replace view public.ai_architect_dashboard
with (security_invoker=true)
as
select
  count(*)::bigint as requests,
  count(*) filter (where final_verified_success)::bigint as successful_verified_tasks,
  avg((first_pass_success is true)::int)::double precision as first_pass_success_rate,
  avg((final_verified_success is true)::int)::double precision as final_success_rate,
  avg((retry_count>0)::int)::double precision as retry_probability,
  avg((fallback_count>0)::int)::double precision as fallback_probability,
  avg((escalation_count>0)::int)::double precision as escalation_probability,
  avg(total_actual_cost_usd) filter (where total_actual_cost_usd is not null) as cost_per_request_usd,
  case
    when count(*) filter (where final_verified_success and total_actual_cost_usd is not null)>0
    then sum(total_actual_cost_usd) filter (where total_actual_cost_usd is not null)
      / count(*) filter (where final_verified_success and total_actual_cost_usd is not null)
    else null
  end as cost_per_successful_verified_task_usd,
  percentile_cont(0.5) within group (order by total_latency_ms) as median_latency_ms,
  percentile_cont(0.9) within group (order by total_latency_ms) as p90_latency_ms
from public.ai_architect_results;

create or replace view public.ai_architect_task_model_stats
with (security_invoker=true)
as
select
  task_class,provider,requested_model as model,coalesce(reasoning_level,'provider-default') as reasoning_level,
  count(*)::bigint as attempts,
  avg((success is true)::int)::double precision as attempt_verified_success_rate,
  avg(actual_cost_usd) filter (where actual_cost_usd is not null) as average_attempt_cost_usd,
  percentile_cont(0.5) within group (order by latency_ms) as median_latency_ms
from public.ai_architect_attempts
group by task_class,provider,requested_model,coalesce(reasoning_level,'provider-default');

revoke all on public.ai_architect_calibration_stats from anon, authenticated;
revoke all on public.ai_architect_dashboard from anon, authenticated;
revoke all on public.ai_architect_task_model_stats from anon, authenticated;
grant select on public.ai_architect_calibration_stats to service_role;
grant select on public.ai_architect_dashboard to service_role;
grant select on public.ai_architect_task_model_stats to service_role;
