import { createClient } from "@supabase/supabase-js";

const MIME = "application/json";
const MAX_ALLOWED_BYTES = 16 * 1024 * 1024;

const bucket = process.env.PISAC_EVIDENCE_STORAGE_BUCKET?.trim() ?? "";
const requestedBytes = Number(
  process.env.PISAC_EVIDENCE_SHADOW_MAX_PAYLOAD_BYTES || 2 * 1024 * 1024,
);
const url = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).trim();
const secret = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""
).trim();

if (
  !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket) ||
  !Number.isSafeInteger(requestedBytes) ||
  requestedBytes < 1 ||
  requestedBytes > MAX_ALLOWED_BYTES
) {
  throw new Error(
    "Evidence Storage bootstrap requires explicit valid PISAC_EVIDENCE_STORAGE_BUCKET and payload limit.",
  );
}
if (!url || !secret) {
  throw new Error(
    "Evidence Storage bootstrap requires a Supabase URL and server secret key.",
  );
}

const supabase = createClient(url, secret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const { data: buckets, error: listError } =
  await supabase.storage.listBuckets();
if (listError) throw new Error("Evidence Storage bucket lookup failed");

const existing = buckets?.find((value) => value.id === bucket) ?? null;

if (!existing) {
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: requestedBytes,
    allowedMimeTypes: [MIME],
  });
  if (error) throw new Error("Evidence Storage bucket creation failed");
  console.log(`Created private Evidence bucket: ${bucket}`);
  process.exit(0);
}

const limit =
  typeof existing.file_size_limit === "number"
    ? existing.file_size_limit
    : Number(existing.file_size_limit);
const allowed = existing.allowed_mime_types;

if (
  existing.public ||
  !Number.isFinite(limit) ||
  limit !== requestedBytes ||
  !Array.isArray(allowed) ||
  allowed.length !== 1 ||
  allowed[0] !== MIME
) {
  throw new Error(
    "Existing Evidence bucket does not exactly match the configured private JSON-only policy.",
  );
}

console.log(`Evidence bucket is ready: ${bucket}`);
