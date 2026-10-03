-- R4 recovery refinement.
-- Live migration version: 20261003074143.
--
-- Adds a pre-storage idempotency lookup so an already accepted
-- pending/signed receipt can be recovered even after the package is closed
-- to NEW evidence. The reserve RPC remains the final atomic chain gate.

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
  v_owned boolean;
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
    return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select pg_catalog.count(*) > 0
  into v_owned
  from pisac_evidence.packages ep
  join public.pisac_documents d on d.id = ep.document_id
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where ep.id = p_evidence_package_id
    and w.owner_id = p_principal_id;

  if not v_owned then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  select * into v_existing
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

create or replace function public.pisac_evidence_reserve(
  p_principal_id uuid,
  p_client_request_id text,
  p_descriptor jsonb,
  p_storage_ref text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_package pisac_evidence.packages%rowtype;
  v_existing pisac_evidence.acceptances%rowtype;
  v_owned boolean;
  v_segment_hash text;
  v_predecessor_hash text;
  v_receipt_id uuid;
  v_accepted_at timestamptz;
  v_receipt_payload jsonb;
  v_record jsonb;
  v_sequence_from bigint;
  v_sequence_to bigint;
  v_event_count bigint;
  v_payload_bytes bigint;
begin
  if p_principal_id is null
     or p_descriptor is null
     or pg_catalog.jsonb_typeof(p_descriptor) is distinct from 'object'
     or p_client_request_id is null
     or pg_catalog.char_length(p_client_request_id) = 0
     or pg_catalog.char_length(p_client_request_id) > 256
     or p_storage_ref is null
     or pg_catalog.char_length(p_storage_ref) = 0
     or pg_catalog.char_length(p_storage_ref) > 1024
  then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;

  begin
    v_package_id := (p_descriptor ->> 'evidencePackageId')::uuid;
    v_sequence_from := (p_descriptor ->> 'sequenceFrom')::bigint;
    v_sequence_to := (p_descriptor ->> 'sequenceTo')::bigint;
    v_event_count := (p_descriptor ->> 'eventCount')::bigint;
    v_payload_bytes := (p_descriptor ->> 'payloadBytes')::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return pg_catalog.jsonb_build_object('status', 'invalid');
  end;

  v_segment_hash := p_descriptor ->> 'segmentHash';
  v_predecessor_hash := p_descriptor ->> 'predecessorSegmentHash';

  if v_package_id is null
     or v_segment_hash is null
     or v_segment_hash !~ '^[0-9a-f]{64}$'
     or (v_predecessor_hash is not null and v_predecessor_hash !~ '^[0-9a-f]{64}$')
     or p_descriptor ->> 'evidenceSchema' is distinct from 'pisac-evidence-segment-v2'
     or p_descriptor ->> 'canonicalization' is distinct from 'RFC8785-JCS'
     or p_descriptor ->> 'hashAlgorithm' is distinct from 'sha256'
     or pg_catalog.coalesce(pg_catalog.char_length(p_descriptor ->> 'documentId'), 0) = 0
     or pg_catalog.coalesce(pg_catalog.char_length(p_descriptor ->> 'sessionId'), 0) = 0
     or pg_catalog.coalesce(pg_catalog.char_length(p_descriptor ->> 'segmentId'), 0) = 0
     or pg_catalog.coalesce(pg_catalog.char_length(p_descriptor ->> 'evidenceProfileId'), 0) = 0
     or v_sequence_from < 1
     or v_sequence_to < v_sequence_from
     or v_event_count < 1
     or v_sequence_to <> v_sequence_from + v_event_count - 1
     or v_payload_bytes < 1
  then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;

  select * into v_package
  from pisac_evidence.packages ep
  where ep.id = v_package_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  if v_package.document_id::text is distinct from p_descriptor ->> 'documentId'
     or v_package.evidence_profile_id is distinct from p_descriptor ->> 'evidenceProfileId'
  then
    return pg_catalog.jsonb_build_object('status', 'context_mismatch');
  end if;

  select pg_catalog.count(*) > 0 into v_owned
  from public.pisac_documents d
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where d.id = v_package.document_id
    and w.owner_id = p_principal_id;

  if not v_owned then
    return pg_catalog.jsonb_build_object('status', 'unauthorized');
  end if;

  select * into v_existing
  from pisac_evidence.acceptances ea
  where ea.principal_id = p_principal_id
    and ea.evidence_package_id = v_package_id
    and ea.client_request_id = p_client_request_id;

  if found then
    if v_existing.descriptor is distinct from p_descriptor
       or v_existing.storage_ref is distinct from p_storage_ref
    then
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
  end if;

  if not v_package.accepts_evidence then
    return pg_catalog.jsonb_build_object('status', 'not_accepting');
  end if;

  if v_payload_bytes > v_package.max_payload_bytes then
    return pg_catalog.jsonb_build_object('status', 'too_large');
  end if;

  if v_package.head_segment_hash is distinct from v_predecessor_hash then
    return pg_catalog.jsonb_build_object(
      'status', 'chain_conflict',
      'expectedPreviousSegmentHash', v_package.head_segment_hash
    );
  end if;

  v_receipt_id := pg_catalog.gen_random_uuid();
  v_accepted_at := pg_catalog.clock_timestamp();

  v_receipt_payload := pg_catalog.jsonb_build_object(
    'receiptSchema', 'pisac-evidence-receipt-v1',
    'receiptId', v_receipt_id,
    'evidencePackageId', v_package.id,
    'documentId', v_package.document_id,
    'sessionId', p_descriptor ->> 'sessionId',
    'segmentId', p_descriptor ->> 'segmentId',
    'segmentHash', v_segment_hash,
    'predecessorSegmentHash', v_predecessor_hash,
    'previousReceiptId', v_package.head_receipt_id,
    'evidenceSchema', p_descriptor ->> 'evidenceSchema',
    'evidenceProfileId', v_package.evidence_profile_id,
    'sequenceFrom', v_sequence_from,
    'sequenceTo', v_sequence_to,
    'eventCount', v_event_count,
    'payloadBytes', v_payload_bytes,
    'acceptedAt',
      pg_catalog.to_char(
        v_accepted_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
  );

  insert into pisac_evidence.acceptances (
    receipt_id, evidence_package_id, principal_id, client_request_id,
    storage_ref, descriptor, segment_hash, predecessor_segment_hash,
    previous_receipt_id, receipt_payload, status, accepted_at
  )
  values (
    v_receipt_id, v_package.id, p_principal_id, p_client_request_id,
    p_storage_ref, p_descriptor, v_segment_hash, v_predecessor_hash,
    v_package.head_receipt_id, v_receipt_payload, 'pending_signature',
    v_accepted_at
  );

  update pisac_evidence.packages
  set head_segment_hash = v_segment_hash,
      head_receipt_id = v_receipt_id,
      updated_at = v_accepted_at
  where id = v_package.id;

  v_record := pg_catalog.jsonb_build_object(
    'clientRequestId', p_client_request_id,
    'principalId', p_principal_id,
    'storageRef', p_storage_ref,
    'descriptor', p_descriptor,
    'receiptPayload', v_receipt_payload,
    'status', 'pending_signature',
    'signedReceipt', null
  );

  return pg_catalog.jsonb_build_object(
    'status', 'reserved',
    'record', v_record
  );

exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('status', 'concurrent_conflict');
end;
$$;

revoke all on function public.pisac_evidence_lookup(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.pisac_evidence_lookup(uuid, uuid, text, jsonb)
  to service_role;
