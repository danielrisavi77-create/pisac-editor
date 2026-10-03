import {
  createHash,
  createPublicKey,
  type JsonWebKey,
} from "node:crypto";

import type {
  PublicVerificationKey,
  SignatureEnvelope,
  SigningKeyProvider,
} from "@/application/ports/signing-key-provider";
import { isPlainObject, ownProperty } from "@/domain/json";

export type AzureKeyVaultSignerConfig = {
  versionedKeyUrl: string;
  keyAlias: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  apiVersion: "2025-07-01";
};

type EnvSource = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export interface AzureAccessTokenProvider {
  getToken(): Promise<string>;
}

type ParsedKeyUrl = {
  versionedKeyUrl: string;
  keyVersion: string;
};

function parseVersionedKeyUrl(value: string): ParsedKeyUrl | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (
      !url.hostname.endsWith(".vault.azure.net") &&
      !url.hostname.endsWith(".managedhsm.azure.net")
    ) {
      return null;
    }
    if (url.search !== "" || url.hash !== "") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 3 ||
      parts[0] !== "keys" ||
      !parts[1] ||
      !parts[2]
    ) {
      return null;
    }

    url.pathname = `/keys/${parts[1]}/${parts[2]}`;
    return {
      versionedKeyUrl: url.toString().replace(/\/$/, ""),
      keyVersion: parts[2],
    };
  } catch {
    return null;
  }
}

export function getAzureKeyVaultSignerConfig(
  env: EnvSource = process.env,
): AzureKeyVaultSignerConfig | null {
  const parsed = parseVersionedKeyUrl(
    env.PISAC_EVIDENCE_AZURE_KEY_URL?.trim() ?? "",
  );
  const keyAlias = env.PISAC_EVIDENCE_SIGNING_KEY_ALIAS?.trim() ?? "";
  const tenantId = env.AZURE_TENANT_ID?.trim() ?? "";
  const clientId = env.AZURE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.AZURE_CLIENT_SECRET?.trim() ?? "";

  if (
    !parsed ||
    keyAlias === "" ||
    keyAlias.length > 256 ||
    tenantId === "" ||
    clientId === "" ||
    clientSecret === ""
  ) {
    return null;
  }

  return {
    versionedKeyUrl: parsed.versionedKeyUrl,
    keyAlias,
    tenantId,
    clientId,
    clientSecret,
    apiVersion: "2025-07-01",
  };
}

export class AzureClientCredentialsTokenProvider
  implements AzureAccessTokenProvider
{
  private cached:
    | { token: string; expiresAtMs: number }
    | null = null;

  constructor(
    private readonly config: Pick<
      AzureKeyVaultSignerConfig,
      "tenantId" | "clientId" | "clientSecret"
    >,
    private readonly fetchFn: FetchLike = fetch,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async getToken(): Promise<string> {
    const now = this.clock();
    if (this.cached && this.cached.expiresAtMs - 60_000 > now) {
      return this.cached.token;
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
      scope: "https://vault.azure.net/.default",
    });

    const response = await this.fetchFn(
      `https://login.microsoftonline.com/${encodeURIComponent(
        this.config.tenantId,
      )}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      throw new Error("azure key vault token unavailable");
    }

    const json: unknown = await response.json();
    if (!isPlainObject(json)) {
      throw new Error("azure key vault token response invalid");
    }

    const token = ownProperty(json, "access_token");
    const expiresIn = ownProperty(json, "expires_in");
    if (
      typeof token !== "string" ||
      token.trim() === "" ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new Error("azure key vault token response invalid");
    }

    this.cached = {
      token,
      expiresAtMs: now + expiresIn * 1000,
    };
    return token;
  }
}

function base64UrlSha256(message: Uint8Array): string {
  return createHash("sha256")
    .update(message)
    .digest("base64url");
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = ownProperty(value, key);
  return typeof field === "string" && field.trim() !== "" ? field : null;
}

/**
 * Azure Key Vault / Managed HSM P-256 signer.
 *
 * The private key never leaves Azure. Sign/verify operate on a SHA-256 digest
 * through Key Vault's ES256 API. A versioned key URL is mandatory so key
 * rotation can never silently reinterpret an old receipt.
 */
export class AzureKeyVaultSigningKeyProvider
  implements SigningKeyProvider
{
  private readonly parsedKey: ParsedKeyUrl;

  constructor(
    private readonly config: AzureKeyVaultSignerConfig,
    private readonly tokens: AzureAccessTokenProvider,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    const parsed = parseVersionedKeyUrl(config.versionedKeyUrl);
    if (!parsed) {
      throw new Error("Azure signing key URL must be version-pinned");
    }
    this.parsedKey = parsed;
  }

  private async authorizedFetch(
    suffix: string,
    init: RequestInit,
  ): Promise<Response> {
    const token = await this.tokens.getToken();
    return this.fetchFn(
      `${this.parsedKey.versionedKeyUrl}${suffix}`,
      {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      },
    );
  }

  async sign(message: Uint8Array): Promise<SignatureEnvelope> {
    const response = await this.authorizedFetch(
      `/sign?api-version=${this.config.apiVersion}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alg: "ES256",
          value: base64UrlSha256(message),
        }),
      },
    );

    if (!response.ok) {
      throw new Error("Azure evidence signing unavailable");
    }
    const json: unknown = await response.json();
    if (!isPlainObject(json)) {
      throw new Error("Azure evidence signature response invalid");
    }
    const signature = stringField(json, "value");
    if (!signature || !/^[A-Za-z0-9_-]+$/.test(signature)) {
      throw new Error("Azure evidence signature response invalid");
    }

    return {
      algorithm: "ECDSA_P256_SHA256",
      keyId: this.config.keyAlias,
      keyVersion: this.parsedKey.keyVersion,
      signatureEncoding: "ieee-p1363",
      signatureBase64Url: signature,
    };
  }

  async verify(
    message: Uint8Array,
    signature: SignatureEnvelope,
  ): Promise<boolean> {
    if (
      signature.algorithm !== "ECDSA_P256_SHA256" ||
      signature.signatureEncoding !== "ieee-p1363" ||
      signature.keyId !== this.config.keyAlias ||
      signature.keyVersion !== this.parsedKey.keyVersion ||
      !/^[A-Za-z0-9_-]+$/.test(signature.signatureBase64Url)
    ) {
      return false;
    }

    const response = await this.authorizedFetch(
      `/verify?api-version=${this.config.apiVersion}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alg: "ES256",
          digest: base64UrlSha256(message),
          value: signature.signatureBase64Url,
        }),
      },
    );

    if (!response.ok) return false;
    const json: unknown = await response.json();
    return (
      isPlainObject(json) &&
      ownProperty(json, "value") === true
    );
  }

  async publicVerificationKey(): Promise<PublicVerificationKey> {
    const response = await this.authorizedFetch(
      `?api-version=${this.config.apiVersion}`,
      { method: "GET" },
    );

    if (!response.ok) {
      throw new Error("Azure evidence public key unavailable");
    }
    const json: unknown = await response.json();
    if (!isPlainObject(json)) {
      throw new Error("Azure evidence public key response invalid");
    }

    const key = ownProperty(json, "key");
    if (!isPlainObject(key)) {
      throw new Error("Azure evidence public key response invalid");
    }

    const crv = stringField(key, "crv");
    const x = stringField(key, "x");
    const y = stringField(key, "y");
    if (crv !== "P-256" || !x || !y) {
      throw new Error("Azure evidence key is not P-256");
    }

    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x,
      y,
    };
    const publicKey = createPublicKey({
      key: jwk,
      format: "jwk",
    });
    const der = publicKey.export({
      type: "spki",
      format: "der",
    });

    return {
      algorithm: "ECDSA_P256_SHA256",
      keyId: this.config.keyAlias,
      keyVersion: this.parsedKey.keyVersion,
      encoding: "spki-der",
      keyBase64Url: Buffer.from(der).toString("base64url"),
    };
  }
}

export function createAzureEvidenceSigner(
  env: EnvSource = process.env,
  fetchFn: FetchLike = fetch,
): AzureKeyVaultSigningKeyProvider | null {
  const config = getAzureKeyVaultSignerConfig(env);
  if (!config) return null;
  return new AzureKeyVaultSigningKeyProvider(
    config,
    new AzureClientCredentialsTokenProvider(config, fetchFn),
    fetchFn,
  );
}
