/**
 * Provider-neutral institutional identity.
 *
 * These attributes establish identity/affiliation facts supplied by an
 * external identity provider. They never grant Pisač document permissions by
 * themselves. Authorization remains a separate Pisač decision.
 */
export type ExternalAffiliation = {
  institutionExternalId: string;
  role: string;
  scopedAffiliation?: string;
};

export type ExternalIdentity = {
  providerId: string;
  subject: string;
  displayName?: string;
  email?: string;
  affiliations: readonly ExternalAffiliation[];
};

export type IdentityResolution =
  | { status: "authenticated"; identity: ExternalIdentity }
  | { status: "anonymous" }
  | { status: "unavailable" };

export interface IdentityProvider {
  readonly providerId: string;
  resolveCurrentIdentity(): Promise<IdentityResolution>;
}
