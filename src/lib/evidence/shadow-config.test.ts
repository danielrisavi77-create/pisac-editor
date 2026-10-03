import { describe, expect, it } from "vitest";

import { getEvidenceShadowConfig } from "./shadow-config";

const base = {
  PISAC_EVIDENCE_SHADOW_ENABLED: "1",
  NEXT_PUBLIC_SITE_URL: "https://pisac.example",
  PISAC_EVIDENCE_STORAGE_BUCKET: "pisac-evidence-shadow",
  PISAC_EVIDENCE_SHADOW_PROFILE_ID: "standard-v1",
};

describe("Evidence shadow configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(getEvidenceShadowConfig({}, "production")).toEqual({
      status: "disabled",
    });
  });

  it("requires pinned origin, explicit bucket/profile and production KMS mode", () => {
    expect(
      getEvidenceShadowConfig(base, "production"),
    ).toEqual({
      status: "ready",
      value: {
        siteOrigin: "https://pisac.example",
        bucket: "pisac-evidence-shadow",
        evidenceProfileId: "standard-v1",
        maxPayloadBytes: 2 * 1024 * 1024,
        maxCommandBytes: 2 * 1024 * 1024 + 256 * 1024,
        signer: { mode: "azure-key-vault" },
      },
    });

    expect(
      getEvidenceShadowConfig(
        {
          ...base,
          NEXT_PUBLIC_SITE_URL: "",
        },
        "production",
      ),
    ).toMatchObject({ status: "misconfigured" });
  });

  it("permits development signing only outside production", () => {
    expect(
      getEvidenceShadowConfig(
        {
          ...base,
          PISAC_EVIDENCE_SIGNER_MODE: "development",
        },
        "test",
      ),
    ).toMatchObject({
      status: "ready",
      value: { signer: { mode: "development" } },
    });

    expect(
      getEvidenceShadowConfig(
        {
          ...base,
          PISAC_EVIDENCE_SIGNER_MODE: "development",
        },
        "production",
      ),
    ).toMatchObject({ status: "misconfigured" });
  });

  it("rejects invalid byte limits and unsupported signer modes", () => {
    expect(
      getEvidenceShadowConfig(
        {
          ...base,
          PISAC_EVIDENCE_SHADOW_MAX_PAYLOAD_BYTES: "999999999",
        },
        "production",
      ),
    ).toMatchObject({ status: "misconfigured" });

    expect(
      getEvidenceShadowConfig(
        {
          ...base,
          PISAC_EVIDENCE_SIGNER_MODE: "mystery",
        },
        "production",
      ),
    ).toMatchObject({ status: "misconfigured" });
  });
});
