import type { SupabaseClient } from "@supabase/supabase-js";

import { AzureKeyVaultSigningKeyProvider, createAzureEvidenceSigner } from "@/adapters/crypto/azure-key-vault-signer";
import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import { SupabaseEvidenceAcceptanceRepository } from "@/adapters/evidence/supabase-evidence-acceptance-repository";
import {
  ensureSupabaseEvidencePackage,
  SupabaseEvidenceContextPort,
} from "@/adapters/evidence/supabase-evidence-context";
import {
  SupabaseEvidencePayloadStore,
  verifySupabaseEvidenceBucket,
} from "@/adapters/evidence/supabase-evidence-payload-store";
import { SupabaseShadowEvidenceAuthorizationPort } from "@/adapters/evidence/supabase-shadow-authorization";
import { EvidenceGateway } from "@/application/evidence/evidence-gateway";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getEvidenceShadowConfig,
  type EvidenceShadowConfig,
} from "./shadow-config";

type EnvSource = Record<string, string | undefined>;

export type EvidenceShadowRuntime = {
  config: EvidenceShadowConfig;
  admin: SupabaseClient;
  gateway: EvidenceGateway;
  ensurePackage(input: {
    actorId: string;
    documentId: string;
  }): ReturnType<typeof ensureSupabaseEvidencePackage>;
};

export type EvidenceShadowRuntimeResult =
  | { status: "disabled" }
  | { status: "misconfigured" }
  | { status: "unavailable" }
  | { status: "ready"; runtime: EvidenceShadowRuntime };

function buildSigner(
  config: EvidenceShadowConfig,
  env: EnvSource,
): SigningKeyProvider | null {
  if (config.signer.mode === "development") {
    return new DevelopmentEd25519SigningKeyProvider(
      "pisac-shadow-dev-ed25519",
      "ephemeral-v1",
    );
  }

  const signer: AzureKeyVaultSigningKeyProvider | null =
    createAzureEvidenceSigner(env);
  return signer;
}

export async function createEvidenceShadowRuntime(
  env: EnvSource = process.env,
): Promise<EvidenceShadowRuntimeResult> {
  const configState = getEvidenceShadowConfig(
    env,
    env.NODE_ENV ?? process.env.NODE_ENV,
  );
  if (configState.status === "disabled") return { status: "disabled" };
  if (configState.status === "misconfigured") {
    return { status: "misconfigured" };
  }

  const admin = createAdminClient(env);
  if (!admin) return { status: "misconfigured" };

  const bucket = await verifySupabaseEvidenceBucket(
    admin,
    configState.value.bucket,
    configState.value.maxPayloadBytes,
  );
  if (bucket.status === "missing" || bucket.status === "misconfigured") {
    return { status: "misconfigured" };
  }
  if (bucket.status === "unavailable") {
    return { status: "unavailable" };
  }

  let signer: SigningKeyProvider | null;
  try {
    signer = buildSigner(configState.value, env);
  } catch {
    return { status: "misconfigured" };
  }
  if (!signer) return { status: "misconfigured" };

  const contexts = new SupabaseEvidenceContextPort(admin);
  const repository = new SupabaseEvidenceAcceptanceRepository(admin);
  const payloadStore = new SupabaseEvidencePayloadStore(
    admin,
    configState.value.bucket,
  );
  const authorization = new SupabaseShadowEvidenceAuthorizationPort(admin);

  return {
    status: "ready",
    runtime: {
      config: configState.value,
      admin,
      gateway: new EvidenceGateway({
        contexts,
        repository,
        payloadStore,
        authorization,
        signer,
      }),
      ensurePackage: ({ actorId, documentId }) =>
        ensureSupabaseEvidencePackage(admin, {
          actorId,
          documentId,
          evidenceProfileId: configState.value.evidenceProfileId,
          maxPayloadBytes: configState.value.maxPayloadBytes,
        }),
    },
  };
}
