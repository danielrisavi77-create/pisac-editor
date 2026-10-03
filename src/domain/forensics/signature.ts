export type SignatureAlgorithm =
  | "Ed25519"
  | "ECDSA_P256_SHA256"
  | "RSA_PSS_SHA256";

export type SignatureEnvelope = {
  algorithm: SignatureAlgorithm;
  keyId: string;
  keyVersion: string;
  signatureBase64Url: string;
};

export type PublicVerificationKey = {
  algorithm: SignatureAlgorithm;
  keyId: string;
  keyVersion: string;
  encoding: "spki-der";
  keyBase64Url: string;
};
