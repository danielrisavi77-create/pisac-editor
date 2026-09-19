create table if not exists public.ai_router_requests_v2 (
  request_id text primary key,
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('preview', 'count', 'execute')),
  profile text,
  task_type text,
  complexity numeric,
  risk numeric,
  context_tokens_before integer,
  context_tokens_after integer,
  context_tokens_saved integer,
  context_saved_pct numeric,
  input_tokens_estimated integer,
  final_provider text,
  final_model text,
  final_reasoning_effort text,
  routing_method text,
  routing_reason jsonb,
  estimated_baseline_cost_usd numeric,
  estimated_routed_cost_usd numeric,
  estimated_savings_usd numeric,
  estimated_savings_pct numeric,
  total_actual_cost_usd numeric,
  total_actual_tokens integer,
  total_latency_ms integer,
  retry_count integer not null default 0,
  escalation_count integer not null default 0,
  fallback_count integer not null default 0,
  first_pass_success boolean,
  final_success boolean,
  prompt_fingerprint text,
  error_type text
);

create table if not exists public.ai_router_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.ai_router_requests_v2(request_id) on delete cascade,
  attempt_number integer not null,
  attempt_kind text not null check (attempt_kind in ('initial', 'retry', 'fallback', 'escalation')),
  provider text not null,
  model text not null,
  reasoning_effort text,
  input_token_method text,
  input_tokens_estimated integer,
  input_tokens_actual integer,
  output_p50 integer,
  output_p90 integer,
  output_p95 integer,
  reasoning_p90_predicted integer,
  output_tokens_actual integer,
  visible_output_tokens_actual integer,
  reasoning_tokens_actual integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  estimated_cost_usd numeric,
  actual_cost_usd numeric,
  actual_cost_source text,
  latency_ms integer,
  verifier_score numeric,
  verifier_passed boolean,
  verifier_failures jsonb,
  success boolean not null default false,
  error_type text,
  transient_error boolean,
  created_at timestamptz not null default now(),
  unique(request_id, attempt_number)
);

create index if not exists ai_router_requests_v2_created_idx on public.ai_router_requests_v2(created_at desc);
create index if not exists ai_router_requests_v2_task_idx on public.ai_router_requests_v2(task_type, final_provider, final_model);
create index if not exists ai_router_attempts_model_idx on public.ai_router_attempts(provider, model, reasoning_effort);
create index if not exists ai_router_attempts_request_idx on public.ai_router_attempts(request_id, attempt_number);

alter table public.ai_router_requests_v2 enable row level security;
alter table public.ai_router_attempts enable row level security;

comment on table public.ai_router_requests_v2 is
  'Privacy-first aggregate AI Router V2 telemetry. No prompt or output body is stored.';
comment on table public.ai_router_attempts is
  'Per-attempt AI Router V2 calibration telemetry. No prompt or output body is stored.';

create or replace view public.ai_router_calibration_dataset as
select
  r.request_id,
  r.task_type,
  r.complexity,
  r.risk,
  r.profile,
  r.retry_count,
  r.escalation_count,
  r.first_pass_success,
  r.final_success,
  a.attempt_number,
  a.provider,
  a.model,
  a.reasoning_effort,
  a.input_tokens_actual,
  a.output_p50,
  a.output_p90,
  a.output_p95,
  a.reasoning_p90_predicted,
  a.output_tokens_actual,
  a.visible_output_tokens_actual,
  a.reasoning_tokens_actual,
  a.estimated_cost_usd,
  a.actual_cost_usd,
  a.latency_ms,
  a.verifier_score,
  a.verifier_passed,
  a.attempt_kind,
  a.success
from public.ai_router_attempts a
join public.ai_router_requests_v2 r using (request_id)
where a.error_type is null;

create or replace view public.ai_router_calibration_stats as
select
  task_type,
  provider,
  model,
  reasoning_effort,
  count(*)::integer as sample_count,
  percentile_cont(0.5) within group (
    order by coalesce(visible_output_tokens_actual, greatest(output_tokens_actual - coalesce(reasoning_tokens_actual, 0), 0))
  ) as output_median,
  percentile_cont(0.9) within group (
    order by coalesce(visible_output_tokens_actual, greatest(output_tokens_actual - coalesce(reasoning_tokens_actual, 0), 0))
  ) as output_p90,
  percentile_cont(0.95) within group (
    order by coalesce(visible_output_tokens_actual, greatest(output_tokens_actual - coalesce(reasoning_tokens_actual, 0), 0))
  ) as output_p95,
  percentile_cont(0.5) within group (order by reasoning_tokens_actual) filter (where reasoning_tokens_actual is not null) as reasoning_median,
  percentile_cont(0.9) within group (order by reasoning_tokens_actual) filter (where reasoning_tokens_actual is not null) as reasoning_p90,
  percentile_cont(0.95) within group (order by reasoning_tokens_actual) filter (where reasoning_tokens_actual is not null) as reasoning_p95,
  count(*) filter (where attempt_number = 1)::integer as initial_sample_count,
  avg((final_success is true)::int) filter (where attempt_number = 1)::numeric as success_rate,
  avg((first_pass_success is true)::int) filter (where attempt_number = 1)::numeric as first_pass_success_rate,
  avg((retry_count > 0)::int) filter (where attempt_number = 1)::numeric as retry_rate,
  avg((escalation_count > 0)::int) filter (where attempt_number = 1)::numeric as escalation_rate,
  avg(verifier_score) filter (where attempt_number = 1 and verifier_score is not null)::numeric as expected_quality_score,
  percentile_cont(0.5) within group (order by latency_ms) filter (where latency_ms is not null) as median_latency_ms,
  sum(coalesce(actual_cost_usd, 0)) / nullif(sum(case when success then 1 else 0 end), 0) as cost_per_success_usd
from public.ai_router_calibration_dataset
where output_tokens_actual is not null
group by task_type, provider, model, reasoning_effort;


create or replace view public.ai_router_dashboard_daily as
select
  date_trunc('day', r.created_at) as day,
  count(*)::integer as requests,
  count(*) filter (where r.final_success is true)::integer as successful_tasks,
  avg((r.first_pass_success is true)::int)::numeric as first_pass_success_rate,
  avg((r.final_success is true)::int)::numeric as final_success_rate,
  avg(coalesce(a.attempt_count, 0))::numeric as average_attempts,
  sum(coalesce(a.input_tokens, 0))::bigint as input_tokens,
  sum(coalesce(a.output_tokens, 0))::bigint as output_tokens,
  sum(coalesce(a.reasoning_tokens, 0))::bigint as reasoning_tokens,
  avg(a.input_prediction_ape) filter (where a.input_prediction_ape is not null)::numeric as input_prediction_mape,
  avg(a.output_p50_ape) filter (where a.output_p50_ape is not null)::numeric as output_p50_mape,
  avg(a.output_p90_ape) filter (where a.output_p90_ape is not null)::numeric as output_p90_mape,
  avg(a.output_p90_covered) filter (where a.output_p90_covered is not null)::numeric as output_p90_coverage,
  sum(coalesce(r.total_actual_cost_usd, 0))::numeric as total_cost_usd,
  avg(r.total_actual_cost_usd) filter (where r.total_actual_cost_usd is not null)::numeric as cost_per_request_usd,
  sum(coalesce(r.total_actual_cost_usd, 0)) /
    nullif(count(*) filter (where r.final_success is true), 0) as cost_per_successful_task_usd,
  sum(coalesce(r.estimated_baseline_cost_usd, 0))::numeric as estimated_baseline_cost_usd,
  sum(coalesce(r.estimated_routed_cost_usd, 0))::numeric as estimated_routed_cost_usd,
  sum(coalesce(r.estimated_savings_usd, 0))::numeric as estimated_savings_usd,
  avg(r.estimated_savings_pct) filter (where r.estimated_savings_pct is not null)::numeric as average_estimated_savings_pct,
  avg((r.escalation_count > 0)::int)::numeric as escalation_rate,
  avg((r.retry_count > 0)::int)::numeric as retry_rate,
  avg(r.retry_count)::numeric as average_retries,
  avg(r.escalation_count)::numeric as average_escalations,
  avg(r.fallback_count)::numeric as average_fallbacks
from public.ai_router_requests_v2 r
left join (
  select
    request_id,
    count(*)::integer as attempt_count,
    sum(coalesce(input_tokens_actual, 0))::bigint as input_tokens,
    sum(coalesce(output_tokens_actual, 0))::bigint as output_tokens,
    sum(coalesce(reasoning_tokens_actual, 0))::bigint as reasoning_tokens,
    avg(abs(input_tokens_actual - input_tokens_estimated)::numeric / greatest(input_tokens_actual, 1))
      filter (where input_tokens_actual is not null and input_tokens_estimated is not null) as input_prediction_ape,
    avg(abs(output_tokens_actual - output_p50)::numeric / greatest(output_tokens_actual, 1))
      filter (where output_tokens_actual is not null and output_p50 is not null) as output_p50_ape,
    avg(abs(output_tokens_actual - output_p90)::numeric / greatest(output_tokens_actual, 1))
      filter (where output_tokens_actual is not null and output_p90 is not null) as output_p90_ape,
    avg((output_tokens_actual <= output_p90)::int)::numeric
      filter (where output_tokens_actual is not null and output_p90 is not null) as output_p90_covered
  from public.ai_router_attempts
  group by request_id
) a using (request_id)
group by date_trunc('day', r.created_at);

create or replace view public.ai_router_provider_share as
select
  final_provider as provider,
  count(*)::integer as requests,
  count(*) filter (where final_success is true)::integer as successful_tasks,
  sum(coalesce(total_actual_cost_usd, 0))::numeric as total_cost_usd,
  avg(total_actual_cost_usd) filter (where total_actual_cost_usd is not null)::numeric as average_cost_usd
from public.ai_router_requests_v2
where final_provider is not null
group by final_provider;

create or replace view public.ai_router_task_model_stats as
select
  r.task_type,
  a.provider,
  a.model,
  a.reasoning_effort,
  count(*)::integer as attempts,
  avg((a.success is true)::int)::numeric as verified_success_rate,
  avg(a.verifier_score) filter (where a.verifier_score is not null)::numeric as average_verifier_score,
  avg(a.actual_cost_usd) filter (where a.actual_cost_usd is not null)::numeric as average_cost_usd,
  percentile_cont(0.5) within group (order by a.latency_ms) filter (where a.latency_ms is not null) as median_latency_ms
from public.ai_router_attempts a
join public.ai_router_requests_v2 r using (request_id)
group by r.task_type, a.provider, a.model, a.reasoning_effort;


alter view public.ai_router_calibration_dataset set (security_invoker = true);
alter view public.ai_router_calibration_stats set (security_invoker = true);
alter view public.ai_router_dashboard_daily set (security_invoker = true);
alter view public.ai_router_provider_share set (security_invoker = true);
alter view public.ai_router_task_model_stats set (security_invoker = true);

revoke all on public.ai_router_calibration_dataset from anon, authenticated;
revoke all on public.ai_router_calibration_stats from anon, authenticated;
revoke all on public.ai_router_dashboard_daily from anon, authenticated;
revoke all on public.ai_router_provider_share from anon, authenticated;
revoke all on public.ai_router_task_model_stats from anon, authenticated;

grant select on public.ai_router_calibration_dataset to service_role;
grant select on public.ai_router_calibration_stats to service_role;
grant select on public.ai_router_dashboard_daily to service_role;
grant select on public.ai_router_provider_share to service_role;
grant select on public.ai_router_task_model_stats to service_role;


-- V2.1 distributed AI Router rate limiting

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.ai_router_rate_limits (
  identity_hash text not null,
  scope text not null check (scope in ('preview', 'count', 'execute')),
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  request_count integer not null default 0 check (request_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (identity_hash, scope, window_start)
);

create table if not exists private.ai_router_rate_limit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  request_id text,
  scope text not null check (scope in ('preview', 'count', 'execute')),
  identity_hash text not null,
  limit_value integer not null,
  current_count integer not null,
  retry_after_seconds integer not null,
  window_start timestamptz not null
);

create index if not exists ai_router_rate_limits_last_seen_idx
  on private.ai_router_rate_limits(last_seen_at);

create index if not exists ai_router_rate_limit_events_occurred_idx
  on private.ai_router_rate_limit_events(occurred_at desc, scope);

alter table private.ai_router_rate_limits enable row level security;
alter table private.ai_router_rate_limit_events enable row level security;

revoke all on private.ai_router_rate_limits from public, anon, authenticated;
revoke all on private.ai_router_rate_limit_events from public, anon, authenticated;
grant select, insert, update, delete on private.ai_router_rate_limits to service_role;
grant select, insert, update, delete on private.ai_router_rate_limit_events to service_role;
grant usage, select on sequence private.ai_router_rate_limit_events_id_seq to service_role;

create or replace function public.claim_ai_router_rate_slot(
  p_identity_hash text,
  p_scope text,
  p_window_seconds integer,
  p_limit integer,
  p_request_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
  v_allowed boolean;
  v_retry_after integer;
begin
  if p_identity_hash is null or p_identity_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid identity hash';
  end if;
  if p_scope not in ('preview', 'count', 'execute') then
    raise exception 'invalid rate-limit scope';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid rate-limit window';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'invalid rate-limit value';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  insert into private.ai_router_rate_limits as rl (
    identity_hash,
    scope,
    window_start,
    window_seconds,
    request_count,
    first_seen_at,
    last_seen_at
  )
  values (
    p_identity_hash,
    p_scope,
    v_window_start,
    p_window_seconds,
    1,
    v_now,
    v_now
  )
  on conflict (identity_hash, scope, window_start)
  do update set
    request_count = rl.request_count + 1,
    last_seen_at = excluded.last_seen_at
  returning request_count into v_count;

  v_allowed := v_count <= p_limit;
  v_retry_after := greatest(
    1,
    ceil(extract(epoch from (v_window_end - v_now)))::integer
  );

  if not v_allowed then
    insert into private.ai_router_rate_limit_events (
      request_id,
      scope,
      identity_hash,
      limit_value,
      current_count,
      retry_after_seconds,
      window_start
    )
    values (
      left(p_request_id, 128),
      p_scope,
      p_identity_hash,
      p_limit,
      v_count,
      v_retry_after,
      v_window_start
    );
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'limit', p_limit,
    'current_count', v_count,
    'remaining', greatest(p_limit - v_count, 0),
    'retry_after_seconds', case when v_allowed then 0 else v_retry_after end,
    'window_seconds', p_window_seconds,
    'window_start', v_window_start,
    'window_end', v_window_end
  );
end;
$$;

create or replace function public.purge_ai_router_rate_limit_data(
  p_before timestamptz default now() - interval '2 days'
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_limit_rows integer := 0;
  v_event_rows integer := 0;
begin
  delete from private.ai_router_rate_limits
  where last_seen_at < p_before;
  get diagnostics v_limit_rows = row_count;

  delete from private.ai_router_rate_limit_events
  where occurred_at < p_before;
  get diagnostics v_event_rows = row_count;

  return v_limit_rows + v_event_rows;
end;
$$;

revoke all on function public.claim_ai_router_rate_slot(text, text, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.purge_ai_router_rate_limit_data(timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_ai_router_rate_slot(text, text, integer, integer, text)
  to service_role;
grant execute on function public.purge_ai_router_rate_limit_data(timestamptz)
  to service_role;

create or replace view public.ai_router_rate_limit_daily
with (security_invoker = true)
as
select
  date_trunc('day', occurred_at) as day,
  scope,
  count(*)::integer as rejected_requests,
  count(distinct identity_hash)::integer as rejected_identities,
  max(current_count)::integer as peak_window_count
from private.ai_router_rate_limit_events
group by date_trunc('day', occurred_at), scope;

revoke all on public.ai_router_rate_limit_daily from public, anon, authenticated;
grant select on public.ai_router_rate_limit_daily to service_role;

comment on table private.ai_router_rate_limits is
  'Atomic AI Router rate-limit counters. Stores only HMAC-pseudonymized identities.';
comment on table private.ai_router_rate_limit_events is
  'Rejected AI Router requests only. No prompt, output, raw IP, user ID, auth header, or provider payload.';
comment on function public.claim_ai_router_rate_slot(text, text, integer, integer, text) is
  'Service-role-only atomic rate slot claim using INSERT ON CONFLICT increment.';
