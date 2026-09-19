import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { getSiteUrl, resolveAuthOrigin } from "@/lib/supabase/config";
import { RETURN_PARAM, sanitizeReturnPath } from "@/lib/supabase/guard";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata = { title: "Prijava — Pisač" };

const page = {
  maxWidth: "36rem",
  margin: "0 auto",
  padding: "4rem 1rem",
} as const;

const notice = {
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "1rem",
  margin: "0 0 1.5rem",
} as const;

const field = {
  display: "block",
  width: "100%",
  padding: "0.6rem 0.75rem",
  margin: "0.5rem 0 1rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--muted)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
} as const;

const button = {
  padding: "0.6rem 1.1rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--fg)",
  background: "var(--fg)",
  color: "var(--bg)",
  font: "inherit",
  cursor: "pointer",
} as const;

/** `/prijava`, carrying the return target when there is a safe one. */
function signInUrl(query: string, returnPath: string | null): string {
  const params = new URLSearchParams(query);
  if (returnPath) {
    params.set(RETURN_PARAM, returnPath);
  }
  return `/prijava?${params.toString()}`;
}

async function signIn(formData: FormData) {
  "use server";

  // The hidden field is as untrusted as the query parameter it came from: a
  // posted form can say anything, so it is sanitized again here.
  const posted = formData.get(RETURN_PARAM);
  const returnPath = sanitizeReturnPath(typeof posted === "string" ? posted : undefined);

  const email = String(formData.get("email") ?? "").trim();
  if (email === "") {
    redirect(signInUrl("greska=1", returnPath));
  }

  const supabase = await createClient();
  if (!supabase) {
    redirect("/postavljanje");
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  // The configured site URL wins; request headers are only a dev fallback, and
  // are never trusted to build the link we mail out when a site URL is pinned.
  const origin = resolveAuthOrigin(getSiteUrl(), host ? `${protocol}://${host}` : null);
  if (!origin) {
    redirect("/postavljanje");
  }

  // The return target travels on the mailed link, so the callback can land
  // the author where they were headed. It is a path from our own allowlist,
  // appended to an origin we pinned above — never a URL from the request.
  const callback = returnPath
    ? `${origin}/auth/callback?${RETURN_PARAM}=${encodeURIComponent(returnPath)}`
    : `${origin}/auth/callback`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback },
  });

  if (error) {
    redirect(signInUrl("greska=1", returnPath));
  }

  redirect(signInUrl("poslano=1", returnPath));
}

export default async function PrijavaPage({
  searchParams,
}: {
  searchParams: Promise<{
    poslano?: string;
    greska?: string;
    dalje?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const returnPath = sanitizeReturnPath(params.dalje);

  return (
    <main style={page}>
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>Prijava</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
        Prijavi se poveznicom koja stiže na e-poštu.
      </p>

      {!configured ? (
        <div style={notice}>
          <p style={{ margin: "0 0 0.5rem" }}>Supabase još nije konfiguriran.</p>
          <Link href="/postavljanje">Upute za postavljanje</Link>
        </div>
      ) : params.poslano === "1" ? (
        <div style={notice}>
          <p style={{ margin: 0 }}>Provjeri e-poštu.</p>
          <p style={{ color: "var(--muted)", margin: "0.5rem 0 0" }}>
            Poslali smo ti poveznicu za prijavu.
          </p>
        </div>
      ) : (
        <>
          {params.greska === "1" ? (
            <div style={notice}>
              <p style={{ margin: 0 }}>
                Prijava nije uspjela. Pokušaj ponovno.
              </p>
            </div>
          ) : null}
          <form action={signIn}>
            {returnPath ? (
              <input type="hidden" name={RETURN_PARAM} value={returnPath} />
            ) : null}
            <label htmlFor="email">E-pošta</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="ime@primjer.hr"
              style={field}
            />
            <button type="submit" style={button}>
              Pošalji poveznicu
            </button>
          </form>
        </>
      )}

      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Natrag na početnu</Link>
      </p>
    </main>
  );
}
