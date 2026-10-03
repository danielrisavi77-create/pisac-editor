import { createClient } from "@supabase/supabase-js";

const BUCKET =
  process.env.PISAC_EVIDENCE_BUCKET?.trim() || "pisac-evidence-shadow";
const MAX_BYTES = 16 * 1024 * 1024;
const MIME = "application/json";

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

if (!url || !secret) {
  throw new Error(
    "Evidence Storage bootstrap requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (legacy service role fallback supported).",
  );
}

const supabase = createClient(url, secret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) throw listError;

const existing = buckets?.find((bucket) => bucket.id === BUCKET) ?? null;

if (!existing) {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [MIME],
  });
  if (error) throw error;
  console.log(`Created private Evidence bucket: ${BUCKET}`);
  process.exit(0);
}

const limit =
  typeof existing.file_size_limit === "number"
    ? existing.file_size_limit
    : Number(existing.file_size_limit);
const allowed = existing.allowed_mime_types;

if (existing.public) {
  throw new Error(`Evidence bucket ${BUCKET} is public; refusing to continue.`);
}
if (!Number.isFinite(limit) || limit > MAX_BYTES) {
  throw new Error(
    `Evidence bucket ${BUCKET} must have an explicit file limit <= ${MAX_BYTES} bytes.`,
  );
}
if (
  !Array.isArray(allowed) ||
  allowed.length !== 1 ||
  allowed[0] !== MIME
) {
  throw new Error(
    `Evidence bucket ${BUCKET} must allow only ${MIME}.`,
  );
}

console.log(`Evidence bucket is ready: ${BUCKET}`);
