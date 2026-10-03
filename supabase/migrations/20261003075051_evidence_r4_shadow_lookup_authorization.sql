-- R4 shadow authorization/deny policies.
-- Live migration version: 20261003075051.
--
-- Tables remain private even if schema exposure changes accidentally.
-- Shadow F1 authorization is owner-only and will later be replaced by the
-- OpenFGA adapter from R2.

create policy pisac_evidence_packages_deny_authenticated
  on pisac_evidence.packages
  for all
  to authenticated
  using (false)
  with check (false);

create policy pisac_evidence_acceptances_deny_authenticated
  on pisac_evidence.acceptances
  for all
  to authenticated
  using (false)
  with check (false);

create policy pisac_evidence_packages_deny_anon
  on pisac_evidence.packages
  for all
  to anon
  using (false)
  with check (false);

create policy pisac_evidence_acceptances_deny_anon
  on pisac_evidence.acceptances
  for all
  to anon
  using (false)
  with check (false);

create or replace function public.pisac_evidence_authorize_append(
  p_principal_id uuid,
  p_evidence_package_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_principal_id is null or p_evidence_package_id is null then
    return pg_catalog.jsonb_build_object('status', 'deny');
  end if;

  select pg_catalog.count(*) > 0
  into v_allowed
  from pisac_evidence.packages ep
  join public.pisac_documents d on d.id = ep.document_id
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where ep.id = p_evidence_package_id
    and w.owner_id = p_principal_id;

  return pg_catalog.jsonb_build_object(
    'status',
    case when v_allowed then 'allow' else 'deny' end
  );
end;
$$;

create or replace function public.pisac_evidence_lookup(
  p_principal_id uuid,
  p_evidence_package_id uuid,
  p_client_request_id text,
  p_descriptor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing pisac_evidence.acceptances%rowtype;
  v_record jsonb;
begin
  if p_principal_id is null
     or p_evidence_package_id is null
     or p_client_request_id is null
     or pg_catalog.char_length(p_client_request_id) = 0
     or pg_catalog.char_length(p_client_request_id) > 256
     or p_descriptor is null
     or pg_catalog.jsonb_typeof(p_descriptor) is distinct from 'object'
  then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;

  select *
  into v_existing
  from pisac_evidence.acceptances ea
  where ea.principal_id = p_principal_id
    and ea.evidence_package_id = p_evidence_package_id
    and ea.client_request_id = p_client_request_id;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  if v_existing.descriptor is distinct from p_descriptor then
    return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
  end if;

  v_record := pg_catalog.jsonb_build_object(
    'clientRequestId', v_existing.client_request_id,
    'principalId', v_existing.principal_id,
    'storageRef', v_existing.storage_ref,
    'descriptor', v_existing.descriptor,
    'receiptPayload', v_existing.receipt_payload,
    'status', v_existing.status,
    'signedReceipt', v_existing.signed_receipt
  );

  return pg_catalog.jsonb_build_object(
    'status',
    case when v_existing.status = 'signed'
      then 'duplicate_signed'
      else 'duplicate_pending'
    end,
    'record', v_record
  );
end;
$$;

revoke all on function public.pisac_evidence_authorize_append(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.pisac_evidence_lookup(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.pisac_evidence_authorize_append(uuid, uuid)
  to service_role;
grant execute on function public.pisac_evidence_lookup(uuid, uuid, text, jsonb)
  to service_role;
