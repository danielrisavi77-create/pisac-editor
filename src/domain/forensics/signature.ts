export type SignatureAlgorithm =
  | "Ed25519"
  | "ECDSA_P256_SHA256"
  | "RSA_PSS_SHA256";

export type SignatureEncoding = "raw" | "ieee-p1363" | "der";

export type SignatureEnvelope = {
  algorithm: SignatureAlgorithm;
  keyId: string;
  keyVersion: string;
  signatureEncoding: SignatureEncoding;
  signatureBase64Url: string;
};

export type PublicVerificationKey = {
  algorithm: SignatureAlgorithm;
  keyId: string;
  keyVersion: string;
  encoding: "spki-der";
  keyBase64Url: string;
};


export function isSignatureEnvelope(value: unknown): value is SignatureEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.algorithm === "Ed25519" ||
      v.algorithm === "ECDSA_P256_SHA256" ||
      v.algorithm === "RSA_PSS_SHA256") &&
    typeof v.keyId === "string" &&
    v.keyId.trim().length > 0 &&
    v.keyId.length <= 2048 &&
    typeof v.keyVersion === "string" &&
    v.keyVersion.trim().length > 0 &&
    v.keyVersion.length <= 256 &&
    (v.signatureEncoding === "raw" ||
      v.signatureEncoding === "ieee-p1363" ||
      v.signatureEncoding === "der") &&
    typeof v.signatureBase64Url === "string" &&
    /^[A-Za-z0-9_-]+$/.test(v.signatureBase64Url)
  );
}

export function isPublicVerificationKey(
  value: unknown,
): value is PublicVerificationKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    isSignatureEnvelope({
      algorithm: v.algorithm,
      keyId: v.keyId,
      keyVersion: v.keyVersion,
      signatureBase64Url: "x",
    }) &&
    v.encoding === "spki-der" &&
    typeof v.keyBase64Url === "string" &&
    /^[A-Za-z0-9_-]+$/.test(v.keyBase64Url)
  );
}
