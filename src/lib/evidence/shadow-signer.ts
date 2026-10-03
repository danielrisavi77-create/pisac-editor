import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  AwsKmsEd25519SigningKeyProvider,
  type AwsKmsEd25519Transport,
} from "@/adapters/crypto/aws-kms-ed25519-signer";
import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import type { EvidenceShadowConfig } from "./shadow-config";

export type EvidenceShadowSignerResult =
  | { status: "ready"; signer: SigningKeyProvider }
  | { status: "unavailable"; reason: string };

let developmentSigner: DevelopmentEd25519SigningKeyProvider | null = null;

export function createEvidenceShadowSigner(
  config: EvidenceShadowConfig,
  options: {
    awsKmsTransport?: AwsKmsEd25519Transport;
    nodeEnv?: string;
  } = {},
): EvidenceShadowSignerResult {
  if (!config.enabled || config.signer === null) {
    return { status: "unavailable", reason: "Evidence shadow is disabled" };
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  if (config.signer.mode === "development") {
    if (nodeEnv === "production") {
      return {
        status: "unavailable",
        reason: "development Evidence signer is prohibited in production",
      };
    }
    developmentSigner ??= new DevelopmentEd25519SigningKeyProvider(
      "pisac-shadow-development",
      "ephemeral-process-v1",
    );
    return { status: "ready", signer: developmentSigner };
  }

  if (!options.awsKmsTransport) {
    return {
      status: "unavailable",
      reason: "AWS KMS transport is not composed in this build",
    };
  }

  return {
    status: "ready",
    signer: new AwsKmsEd25519SigningKeyProvider(
      options.awsKmsTransport,
      config.signer.keyId,
    ),
  };
}
