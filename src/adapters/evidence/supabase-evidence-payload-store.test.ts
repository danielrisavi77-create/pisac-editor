import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVIDENCE_BUCKET,
  EVIDENCE_CONTENT_TYPE,
  evidenceObjectPath,
  SupabaseEvidencePayloadStore,
  verifySupabaseEvidenceBucket,
} from "./supabase-evidence-payload-store";

const PACKAGE = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

function client(input: {
  uploadError?: unknown;
  downloadText?: string;
  downloadError?: unknown;
  bucket?: {
    public: boolean;
    file_size_limit: number | string | null;
    allowed_mime_types: string[] | null;
  } | null;
  bucketError?: unknown;
}) {
  const uploads: Array<{
    bucket: string;
    path: string;
    options: unknown;
    body: Blob;
  }> = [];

  const fake = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, body: Blob, options: unknown) {
            uploads.push({ bucket, path, options, body });
            return { data: input.uploadError ? null : { path }, error: input.uploadError ?? null };
          },
          async download() {
            return input.downloadError
              ? { data: null, error: input.downloadError }
              : {
                  data: new Blob([input.downloadText ?? ""], {
                    type: EVIDENCE_CONTENT_TYPE,
                  }),
                  error: null,
                };
          },
        };
      },
      async getBucket() {
        return {
          data: input.bucket ?? null,
          error: input.bucketError ?? null,
        };
      },
    },
  } as unknown as SupabaseClient;

  return { fake, uploads };
}

describe("SupabaseEvidencePayloadStore", () => {
  it("uses a deterministic package/hash path and immutable upload", async () => {
    expect(
      evidenceObjectPath({
        evidencePackageId: PACKAGE,
        segmentHash: HASH,
      }),
    ).toBe(`v2/${PACKAGE}/${HASH}.json`);

    const { fake, uploads } = client({});
    const store = new SupabaseEvidencePayloadStore(fake);
    const payload = '{"x":1}';

    await expect(
      store.putImmutable({
        evidencePackageId: PACKAGE,
        segmentHash: HASH,
        canonicalPayload: payload,
      }),
    ).resolves.toEqual({
      status: "stored",
      storageRef:
        `supabase://${DEFAULT_EVIDENCE_BUCKET}/v2/${PACKAGE}/${HASH}.json`,
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe(DEFAULT_EVIDENCE_BUCKET);
    expect(uploads[0].options).toMatchObject({
      upsert: false,
      contentType: EVIDENCE_CONTENT_TYPE,
      cacheControl: "0",
    });
    expect(await uploads[0].body.text()).toBe(payload);
  });

  it("treats a duplicate as idempotent only after exact byte comparison", async () => {
    const same = client({
      uploadError: { statusCode: 409, message: "Duplicate" },
      downloadText: '{"x":1}',
    });
    const sameStore = new SupabaseEvidencePayloadStore(same.fake);
    await expect(
      sameStore.putImmutable({
        evidencePackageId: PACKAGE,
        segmentHash: HASH,
        canonicalPayload: '{"x":1}',
      }),
    ).resolves.toMatchObject({ status: "existing" });

    const different = client({
      uploadError: { statusCode: 409, message: "Duplicate" },
      downloadText: '{"x":2}',
    });
    const differentStore = new SupabaseEvidencePayloadStore(different.fake);
    await expect(
      differentStore.putImmutable({
        evidencePackageId: PACKAGE,
        segmentHash: HASH,
        canonicalPayload: '{"x":1}',
      }),
    ).resolves.toEqual({ status: "conflict" });
  });

  it("distinguishes storage outage from immutable conflicts", async () => {
    const failed = client({
      uploadError: { statusCode: 503, message: "unavailable" },
    });
    await expect(
      new SupabaseEvidencePayloadStore(failed.fake).putImmutable({
        evidencePackageId: PACKAGE,
        segmentHash: HASH,
        canonicalPayload: '{"x":1}',
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "evidence object upload failed",
    });

    expect(
      evidenceObjectPath({
        evidencePackageId: "not-a-uuid",
        segmentHash: HASH,
      }),
    ).toBeNull();
  });
});

describe("verifySupabaseEvidenceBucket", () => {
  it("requires a private JSON-only bucket with an explicit <=16MiB limit", async () => {
    const ready = client({
      bucket: {
        public: false,
        file_size_limit: 2 * 1024 * 1024,
        allowed_mime_types: [EVIDENCE_CONTENT_TYPE],
      },
    });
    await expect(verifySupabaseEvidenceBucket(ready.fake)).resolves.toEqual({
      status: "ready",
    });

    const publicBucket = client({
      bucket: {
        public: true,
        file_size_limit: 1024,
        allowed_mime_types: [EVIDENCE_CONTENT_TYPE],
      },
    });
    await expect(
      verifySupabaseEvidenceBucket(publicBucket.fake),
    ).resolves.toEqual({
      status: "misconfigured",
      reason: "evidence bucket is public",
    });
  });

  it("distinguishes missing bucket and provider outage", async () => {
    const missing = client({
      bucketError: { statusCode: 404, message: "Bucket not found" },
    });
    await expect(verifySupabaseEvidenceBucket(missing.fake)).resolves.toEqual({
      status: "missing",
    });

    const down = client({
      bucketError: { statusCode: 503, message: "down" },
    });
    await expect(verifySupabaseEvidenceBucket(down.fake)).resolves.toEqual({
      status: "unavailable",
      reason: "bucket lookup failed",
    });
  });
});
