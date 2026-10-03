import {
  DEFAULT_EVIDENCE_BUCKET,
  MAX_EVIDENCE_OBJECT_BYTES,
} from "@/adapters/evidence/supabase-evidence-payload-store";

export const DEFAULT_EVIDENCE_PROFILE_ID = "standard-v1";
export const DEFAULT_EVIDENCE_PROFILE_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_EVIDENCE_COMMAND_BYTES =
  DEFAULT_EVIDENCE_PROFILE_MAX_BYTES + 64 * 1024;

type EnvSource = Record<string, string | undefined>;

export type EvidenceShadowSignerConfig =
  | { mode: "development" }
  | { mode: "aws-kms"; keyId: string };

export type EvidenceShadowConfig = {
  enabled: boolean;
  bucket: string;
  evidenceProfileId: string;
  maxPayloadBytes: number;
  maxCommandBytes: number;
  signer: EvidenceShadowSignerConfig | null;
};

export type EvidenceShadowConfigResult =
  | { ok: true; value: EvidenceShadowConfig }
  | { ok: false; reason: string };

function boundedPositiveInteger(
  raw: string | undefined,
  fallback: number,
  max: number,
): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= max
    ? value
    : null;
}

export function getEvidenceShadowConfig(
  env: EnvSource = process.env,
  nodeEnv = process.env.NODE_ENV,
): EvidenceShadowConfigResult {
  const enabled = env.PISAC_EVIDENCE_SHADOW_ENABLED === "1";
  const bucket =
    env.PISAC_EVIDENCE_BUCKET?.trim() || DEFAULT_EVIDENCE_BUCKET;
  const evidenceProfileId =
    env.PISAC_EVIDENCE_PROFILE_ID?.trim() || DEFAULT_EVIDENCE_PROFILE_ID;
  const maxPayloadBytes = boundedPositiveInteger(
    env.PISAC_EVIDENCE_MAX_PAYLOAD_BYTES,
    DEFAULT_EVIDENCE_PROFILE_MAX_BYTES,
    MAX_EVIDENCE_OBJECT_BYTES,
  );

  if (
    !/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket) ||
    evidenceProfileId.length === 0 ||
    evidenceProfileId.length > 120 ||
    maxPayloadBytes === null
  ) {
    return { ok: false, reason: "invalid Evidence shadow configuration" };
  }

  if (!enabled) {
    return {
      ok: true,
      value: {
        enabled: false,
        bucket,
        evidenceProfileId,
        maxPayloadBytes,
        maxCommandBytes: Math.min(
          maxPayloadBytes + 64 * 1024,
          MAX_EVIDENCE_OBJECT_BYTES,
        ),
        signer: null,
      },
    };
  }

  const signerMode =
    env.PISAC_EVIDENCE_SIGNER_MODE?.trim() ||
    (nodeEnv === "production" ? "aws-kms" : "development");

  let signer: EvidenceShadowSignerConfig;
  if (signerMode === "development") {
    if (nodeEnv === "production") {
      return {
        ok: false,
        reason: "development Evidence signer is prohibited in production",
      };
    }
    signer = { mode: "development" };
  } else if (signerMode === "aws-kms") {
    const keyId = env.PISAC_EVIDENCE_AWS_KMS_KEY_ID?.trim() ?? "";
    if (!keyId) {
      return {
        ok: false,
        reason: "AWS KMS Evidence key is not configured",
      };
    }
    signer = { mode: "aws-kms", keyId };
  } else {
    return { ok: false, reason: "unsupported Evidence signer mode" };
  }

  return {
    ok: true,
    value: {
      enabled,
      bucket,
      evidenceProfileId,
      maxPayloadBytes,
      maxCommandBytes: Math.min(
        maxPayloadBytes + 64 * 1024,
        MAX_EVIDENCE_OBJECT_BYTES,
      ),
      signer,
    },
  };
}
