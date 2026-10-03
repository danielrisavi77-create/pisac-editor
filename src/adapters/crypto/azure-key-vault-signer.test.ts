import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AzureClientCredentialsTokenProvider,
  AzureKeyVaultSigningKeyProvider,
  getAzureKeyVaultSignerConfig,
  type AzureAccessTokenProvider,
  type AzureKeyVaultSignerConfig,
} from "./azure-key-vault-signer";

const config: AzureKeyVaultSignerConfig = {
  versionedKeyUrl:
    "https://pisac-eu.vault.azure.net/keys/evidence-signing/abc123",
  keyAlias: "eu-evidence-primary",
  tenantId: "tenant",
  clientId: "client",
  clientSecret: "secret",
  apiVersion: "2025-07-01",
};

class StaticTokenProvider implements AzureAccessTokenProvider {
  async getToken(): Promise<string> {
    return "token-1";
  }
}

describe("Azure Key Vault evidence signer", () => {
  it("requires an explicit version-pinned key URL and complete server credentials", () => {
    expect(
      getAzureKeyVaultSignerConfig({
        PISAC_EVIDENCE_AZURE_KEY_URL:
          "https://pisac-eu.vault.azure.net/keys/evidence-signing/abc123",
        PISAC_EVIDENCE_SIGNING_KEY_ALIAS: "evidence-primary",
        AZURE_TENANT_ID: "tenant",
        AZURE_CLIENT_ID: "client",
        AZURE_CLIENT_SECRET: "secret",
      }),
    ).toMatchObject({
      keyAlias: "evidence-primary",
      apiVersion: "2025-07-01",
    });

    expect(
      getAzureKeyVaultSignerConfig({
        PISAC_EVIDENCE_AZURE_KEY_URL:
          "https://pisac-eu.vault.azure.net/keys/evidence-signing",
        PISAC_EVIDENCE_SIGNING_KEY_ALIAS: "evidence-primary",
        AZURE_TENANT_ID: "tenant",
        AZURE_CLIENT_ID: "client",
        AZURE_CLIENT_SECRET: "secret",
      }),
    ).toBeNull();

    expect(
      getAzureKeyVaultSignerConfig({
        PISAC_EVIDENCE_AZURE_KEY_URL:
          "https://attacker.example/keys/evidence-signing/abc123",
        PISAC_EVIDENCE_SIGNING_KEY_ALIAS: "evidence-primary",
        AZURE_TENANT_ID: "tenant",
        AZURE_CLIENT_ID: "client",
        AZURE_CLIENT_SECRET: "secret",
      }),
    ).toBeNull();
  });

  it("caches OAuth client-credential tokens until the refresh window", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "azure-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    let now = 1_000_000;
    const provider = new AzureClientCredentialsTokenProvider(
      config,
      fetchFn as typeof fetch,
      () => now,
    );

    expect(await provider.getToken()).toBe("azure-token");
    expect(await provider.getToken()).toBe("azure-token");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 3_550_000;
    expect(await provider.getToken()).toBe("azure-token");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("sends only the SHA-256 digest to Key Vault and labels ES256 wire encoding", async () => {
    const message = new TextEncoder().encode("receipt canonical bytes");
    const expectedDigest = createHash("sha256")
      .update(message)
      .digest("base64url");

    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain(
        "/keys/evidence-signing/abc123/sign?api-version=2025-07-01",
      );
      expect(init?.headers).toMatchObject({
        authorization: "Bearer token-1",
        "content-type": "application/json",
      });
      const body = JSON.parse(String(init?.body)) as {
        alg: string;
        value: string;
      };
      expect(body).toEqual({
        alg: "ES256",
        value: expectedDigest,
      });

      return new Response(JSON.stringify({ value: "AQIDBA" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const signer = new AzureKeyVaultSigningKeyProvider(
      config,
      new StaticTokenProvider(),
      fetchFn as typeof fetch,
    );

    await expect(signer.sign(message)).resolves.toEqual({
      algorithm: "ECDSA_P256_SHA256",
      keyId: "eu-evidence-primary",
      keyVersion: "abc123",
      signatureEncoding: "ieee-p1363",
      signatureBase64Url: "AQIDBA",
    });
  });

  it("verifies through the same pinned Key Vault key and rejects metadata mismatch locally", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain(
        "/keys/evidence-signing/abc123/verify?api-version=2025-07-01",
      );
      const body = JSON.parse(String(init?.body)) as {
        alg: string;
        digest: string;
        value: string;
      };
      expect(body.alg).toBe("ES256");
      expect(body.value).toBe("AQIDBA");
      expect(body.digest).toMatch(/^[A-Za-z0-9_-]+$/);

      return new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const signer = new AzureKeyVaultSigningKeyProvider(
      config,
      new StaticTokenProvider(),
      fetchFn as typeof fetch,
    );
    const message = new TextEncoder().encode("receipt");

    expect(
      await signer.verify(message, {
        algorithm: "ECDSA_P256_SHA256",
        keyId: "eu-evidence-primary",
        keyVersion: "abc123",
        signatureEncoding: "ieee-p1363",
        signatureBase64Url: "AQIDBA",
      }),
    ).toBe(true);

    expect(
      await signer.verify(message, {
        algorithm: "ECDSA_P256_SHA256",
        keyId: "wrong",
        keyVersion: "abc123",
        signatureEncoding: "ieee-p1363",
        signatureBase64Url: "AQIDBA",
      }),
    ).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("exports the pinned P-256 public key as SPKI verification material", async () => {
    const { publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const jwk = publicKey.export({ format: "jwk" });
    if (!jwk.x || !jwk.y) throw new Error("test JWK missing coordinates");

    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          key: {
            kty: "EC-HSM",
            crv: "P-256",
            x: jwk.x,
            y: jwk.y,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const signer = new AzureKeyVaultSigningKeyProvider(
      config,
      new StaticTokenProvider(),
      fetchFn as typeof fetch,
    );

    const result = await signer.publicVerificationKey();
    expect(result).toMatchObject({
      algorithm: "ECDSA_P256_SHA256",
      keyId: "eu-evidence-primary",
      keyVersion: "abc123",
      encoding: "spki-der",
    });
    expect(result.keyBase64Url).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
