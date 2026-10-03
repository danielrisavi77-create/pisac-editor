import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVIDENCE_PROFILE_MAX_BYTES,
  getEvidenceShadowConfig,
} from "./shadow-config";

describe("Evidence shadow configuration", () => {
  it("is disabled by default and uses a development signer only outside production", () => {
    expect(getEvidenceShadowConfig({}, "test")).toEqual({
      ok: true,
      value: {
        enabled: false,
        bucket: "pisac-evidence-shadow",
        evidenceProfileId: "standard-v1",
        maxPayloadBytes: DEFAULT_EVIDENCE_PROFILE_MAX_BYTES,
        maxCommandBytes: DEFAULT_EVIDENCE_PROFILE_MAX_BYTES + 64 * 1024,
        signer: { mode: "development" },
      },
    });
  });

  it("requires an explicit AWS KMS key in production", () => {
    expect(getEvidenceShadowConfig({}, "production")).toEqual({
      ok: false,
      reason: "AWS KMS Evidence key is not configured",
    });

    expect(
      getEvidenceShadowConfig(
        {
          PISAC_EVIDENCE_SHADOW_ENABLED: "1",
          PISAC_EVIDENCE_SIGNER_MODE: "aws-kms",
          PISAC_EVIDENCE_AWS_KMS_KEY_ID: "alias/pisac-evidence",
        },
        "production",
      ),
    ).toMatchObject({
      ok: true,
      value: {
        enabled: true,
        signer: {
          mode: "aws-kms",
          keyId: "alias/pisac-evidence",
        },
      },
    });
  });

  it("refuses development signing in production and invalid byte limits", () => {
    expect(
      getEvidenceShadowConfig(
        { PISAC_EVIDENCE_SIGNER_MODE: "development" },
        "production",
      ),
    ).toEqual({
      ok: false,
      reason: "development Evidence signer is prohibited in production",
    });

    expect(
      getEvidenceShadowConfig(
        { PISAC_EVIDENCE_MAX_PAYLOAD_BYTES: "999999999" },
        "test",
      ),
    ).toEqual({
      ok: false,
      reason: "invalid Evidence shadow configuration",
    });
  });
});
