import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EvidencePayloadPutResult,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";
import { isPlainObject } from "@/domain/json";

export const DEFAULT_EVIDENCE_BUCKET = "pisac-evidence-shadow";
export const MAX_EVIDENCE_OBJECT_BYTES = 16 * 1024 * 1024;
export const EVIDENCE_CONTENT_TYPE = "application/json";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function isDuplicateStorageError(error: unknown): boolean {
  if (!isPlainObject(error)) return false;
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : "";
  const name = typeof error.name === "string" ? error.name.toLowerCase() : "";
  const statusCode =
    typeof error.statusCode === "string" || typeof error.statusCode === "number"
      ? String(error.statusCode)
      : "";

  return (
    name.includes("duplicate") ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    statusCode === "409"
  );
}

export function evidenceObjectPath(input: {
  evidencePackageId: string;
  segmentHash: string;
}): string | null {
  if (
    !UUID.test(input.evidencePackageId) ||
    !SHA256.test(input.segmentHash)
  ) {
    return null;
  }
  return `v2/${input.evidencePackageId}/${input.segmentHash}.json`;
}

export class SupabaseEvidencePayloadStore implements EvidencePayloadStore {
  constructor(
    private readonly supabaseAdmin: SupabaseClient,
    private readonly bucket = DEFAULT_EVIDENCE_BUCKET,
  ) {}

  async putImmutable(input: {
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    const path = evidenceObjectPath(input);
    if (!path) return { status: "conflict" };

    const exactBytes = new TextEncoder().encode(input.canonicalPayload);
    if (
      exactBytes.byteLength < 1 ||
      exactBytes.byteLength > MAX_EVIDENCE_OBJECT_BYTES
    ) {
      return { status: "conflict" };
    }

    const storage = this.supabaseAdmin.storage.from(this.bucket);
    const { error } = await storage.upload(
      path,
      new Blob([exactBytes], { type: EVIDENCE_CONTENT_TYPE }),
      {
        contentType: EVIDENCE_CONTENT_TYPE,
        upsert: false,
        cacheControl: "0",
      },
    );

    const storageRef = `supabase://${this.bucket}/${path}`;

    if (!error) {
      return { status: "stored", storageRef };
    }
    if (!isDuplicateStorageError(error)) {
      return { status: "unavailable", reason: "evidence object upload failed" };
    }

    const downloaded = await storage.download(path);
    if (downloaded.error || !downloaded.data) {
      return {
        status: "unavailable",
        reason: "existing evidence object could not be verified",
      };
    }

    const existing = await downloaded.data.text();
    return existing === input.canonicalPayload
      ? { status: "existing", storageRef }
      : { status: "conflict" };
  }
}

export type EvidenceBucketReadiness =
  | { status: "ready" }
  | { status: "missing" }
  | { status: "misconfigured"; reason: string }
  | { status: "unavailable"; reason: string };

export async function verifySupabaseEvidenceBucket(
  supabaseAdmin: SupabaseClient,
  bucket = DEFAULT_EVIDENCE_BUCKET,
): Promise<EvidenceBucketReadiness> {
  const { data, error } = await supabaseAdmin.storage.getBucket(bucket);

  if (error) {
    const message =
      isPlainObject(error) && typeof error.message === "string"
        ? error.message.toLowerCase()
        : "";
    const status =
      isPlainObject(error) &&
      (typeof error.statusCode === "string" ||
        typeof error.statusCode === "number")
        ? String(error.statusCode)
        : "";

    if (
      status === "404" ||
      message.includes("not found") ||
      message.includes("does not exist")
    ) {
      return { status: "missing" };
    }
    return { status: "unavailable", reason: "bucket lookup failed" };
  }

  if (!data) return { status: "missing" };
  if (data.public) {
    return { status: "misconfigured", reason: "evidence bucket is public" };
  }

  const limit =
    typeof data.file_size_limit === "number"
      ? data.file_size_limit
      : typeof data.file_size_limit === "string"
        ? Number(data.file_size_limit)
        : null;

  if (
    limit === null ||
    !Number.isFinite(limit) ||
    limit > MAX_EVIDENCE_OBJECT_BYTES
  ) {
    return {
      status: "misconfigured",
      reason: "evidence bucket file-size limit is missing or too large",
    };
  }

  const allowed = data.allowed_mime_types;
  if (
    !Array.isArray(allowed) ||
    !allowed.includes(EVIDENCE_CONTENT_TYPE) ||
    allowed.some((value) => value !== EVIDENCE_CONTENT_TYPE)
  ) {
    return {
      status: "misconfigured",
      reason: "evidence bucket MIME policy is not JSON-only",
    };
  }

  return { status: "ready" };
}
