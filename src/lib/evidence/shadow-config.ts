import { MAX_EVIDENCE_OBJECT_BYTES } from "@/adapters/evidence/supabase-evidence-payload-store";
import { getSiteUrl } from "@/lib/supabase/config";

type EnvSource = Record<string, string | undefined>;

export type EvidenceShadowSignerConfig =
  | { mode: "development" }
  | { mode: "azure-key-vault" };

export type EvidenceShadowConfig = {
  siteOrigin: string;
  bucket: string;
  evidenceProfileId: string;
  maxPayloadBytes: number;
  maxCommandBytes: number;
  signer: EvidenceShadowSignerConfig;
};

export type EvidenceShadowConfigResult =
  | { status: "disabled" }
  | { status: "misconfigured"; reason: string }
  | { status: "ready"; value: EvidenceShadowConfig };

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
  if (env.PISAC_EVIDENCE_SHADOW_ENABLED !== "1") {
    return { status: "disabled" };
  }

  const siteOrigin = getSiteUrl(env);
  const bucket = env.PISAC_EVIDENCE_STORAGE_BUCKET?.trim() ?? "";
  const evidenceProfileId =
    env.PISAC_EVIDENCE_SHADOW_PROFILE_ID?.trim() ?? "";
  const maxPayloadBytes = boundedPositiveInteger(
    env.PISAC_EVIDENCE_SHADOW_MAX_PAYLOAD_BYTES,
    2 * 1024 * 1024,
    MAX_EVIDENCE_OBJECT_BYTES,
  );

  if (
    !siteOrigin ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket) ||
    evidenceProfileId.length === 0 ||
    evidenceProfileId.length > 120 ||
    maxPayloadBytes === null
  ) {
    return {
      status: "misconfigured",
      reason: "Evidence shadow policy configuration is incomplete",
    };
  }

  const requestedMode =
    env.PISAC_EVIDENCE_SIGNER_MODE?.trim() ||
    (nodeEnv === "production" ? "azure-key-vault" : "development");

  if (
    requestedMode !== "development" &&
    requestedMode !== "azure-key-vault"
  ) {
    return {
      status: "misconfigured",
      reason: "unsupported Evidence shadow signer mode",
    };
  }
  if (requestedMode === "development" && nodeEnv === "production") {
    return {
      status: "misconfigured",
      reason: "development Evidence signer is prohibited in production",
    };
  }

  return {
    status: "ready",
    value: {
      siteOrigin,
      bucket,
      evidenceProfileId,
      maxPayloadBytes,
      maxCommandBytes:
        maxPayloadBytes + 256 * 1024,
      signer: { mode: requestedMode },
    },
  };
}
