-- Live-history reconciliation marker.
-- The same idempotent CREATE OR REPLACE hardening was re-applied on the live
-- Supabase project at version 20261003082323 after a concurrent architecture
-- session had already applied version 20261003081415.
--
-- Keep this migration so a fresh environment reproduces the exact live
-- migration sequence. Re-applying the same function definition is a no-op
-- with respect to final schema behavior.

-- R4 signature algorithm/encoding pair hardening.
-- Live migration version: 20261003081415.
--
-- A signature algorithm does not fully define its wire representation.
-- Accept only combinations with explicit semantics:
-- Ed25519 -> raw; P-256 ECDSA -> IEEE-P1363 or DER; RSA-PSS -> raw octets.

create or replace function public.pisac_evidence_attach_signature(
  p_receipt_id uuid,
  p_signed_receipt jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row pisac_evidence.acceptances%rowtype;
  v_signature jsonb;
  v_digest text;
  v_algorithm text;
  v_encoding text;
begin
  if p_receipt_id is null
     or p_signed_receipt is null
     or pg_catalog.jsonb_typeof(p_signed_receipt) is distinct from 'object'
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  select * into v_row
  from pisac_evidence.acceptances ea
  where ea.receipt_id = p_receipt_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  if p_signed_receipt -> 'payload' is distinct from v_row.receipt_payload then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  v_digest := p_signed_receipt ->> 'payloadDigestSha256';
  v_signature := p_signed_receipt -> 'signature';
  v_algorithm := v_signature ->> 'algorithm';
  v_encoding := v_signature ->> 'signatureEncoding';

  if v_digest is null
     or v_digest !~ '^[0-9a-f]{64}$'
     or v_signature is null
     or pg_catalog.jsonb_typeof(v_signature) is distinct from 'object'
     or v_algorithm not in ('Ed25519', 'ECDSA_P256_SHA256', 'RSA_PSS_SHA256')
     or not (
       (v_algorithm = 'Ed25519' and v_encoding = 'raw')
       or (
         v_algorithm = 'ECDSA_P256_SHA256'
         and v_encoding in ('ieee-p1363', 'der')
       )
       or (v_algorithm = 'RSA_PSS_SHA256' and v_encoding = 'raw')
     )
     or pg_catalog.coalesce(pg_catalog.char_length(v_signature ->> 'keyId'), 0) = 0
     or pg_catalog.coalesce(pg_catalog.char_length(v_signature ->> 'keyVersion'), 0) = 0
     or pg_catalog.coalesce(pg_catalog.char_length(v_signature ->> 'signatureBase64Url'), 0) = 0
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  if v_row.status = 'signed' then
    return pg_catalog.jsonb_build_object(
      'status', 'already_attached',
      'receipt', v_row.signed_receipt
    );
  end if;

  update pisac_evidence.acceptances
  set status = 'signed',
      signed_receipt = p_signed_receipt,
      signed_at = pg_catalog.clock_timestamp()
  where receipt_id = p_receipt_id;

  return pg_catalog.jsonb_build_object('status', 'attached');
end;
$$;

revoke all on function public.pisac_evidence_attach_signature(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.pisac_evidence_attach_signature(uuid, jsonb)
  to service_role;

