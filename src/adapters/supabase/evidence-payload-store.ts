import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EvidencePayloadPutResult,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";

const HASH = /^[0-9a-f]{64}$/;

function safePackageId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,256}$/.test(value);
}

export class SupabaseEvidencePayloadStore
  implements EvidencePayloadStore
{
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly bucketId: string,
  ) {
    if (!bucketId.trim()) {
      throw new Error("evidence storage bucket is required");
    }
  }

  private pathFor(evidencePackageId: string, segmentHash: string): string {
    if (!safePackageId(evidencePackageId) || !HASH.test(segmentHash)) {
      throw new Error("invalid evidence storage identity");
    }
    return `v2/${evidencePackageId}/${segmentHash}.json`;
  }

  async putImmutable(input: {
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    let path: string;
    try {
      path = this.pathFor(input.evidencePackageId, input.segmentHash);
    } catch {
      return { status: "conflict" };
    }

    const bytes = new TextEncoder().encode(input.canonicalPayload);
    const bucket = this.supabase.storage.from(this.bucketId);
    const { error } = await bucket.upload(path, bytes, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "0",
      upsert: false,
    });

    const storageRef = `supabase-storage://${this.bucketId}/${path}`;
    if (!error) {
      return { status: "stored", storageRef };
    }

    // Any failed non-upsert upload may be a retry racing with an object that
    // already exists. Verify the exact bytes before calling it idempotent.
    const { data: existing, error: downloadError } = await bucket.download(path);
    if (downloadError || !existing) {
      return {
        status: "unavailable",
        reason: "evidence object storage unavailable",
      };
    }

    const existingPayload = await existing.text();
    if (existingPayload === input.canonicalPayload) {
      return { status: "existing", storageRef };
    }

    return { status: "conflict" };
  }
}
