import type { NextConfig } from "next";

/**
 * Content Security Policy for every route (F1-10).
 *
 * Read the relaxations, because they are the whole point of writing this out:
 *
 *   script-src 'unsafe-inline' — Next's App Router ships its route payload and
 *     its bootstrap as inline <script> tags on every server-rendered page. A
 *     nonce would require rendering every page dynamically (a nonce has to be
 *     per-response), which would give up static rendering for the whole site;
 *     that trade is an F2 decision, not a security pass. Until then the policy
 *     is honest about being weaker than it looks: 'unsafe-inline' means the
 *     script-src directive stops remote script loads, not injected inline
 *     script. The XSS fixed in public/legacy/assets/app.js was fixed at the
 *     source (createElement + textContent) rather than mitigated here.
 *
 *   style-src 'unsafe-inline' — React writes inline `style` attributes, and
 *     this codebase uses them directly in several server components.
 *
 *   fonts.googleapis.com / fonts.gstatic.com — the legacy prototype at
 *     /legacy/index.html links a Google Fonts stylesheet.
 *
 * Everything else is closed: no framing at all (frame-ancestors 'none', with
 * X-Frame-Options as the answer for anything that predates it), no external
 * origins for scripts, connections only to ourselves and to Supabase.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
] as const;

const nextConfig: NextConfig = {
  // Applied to every response Next serves, the static prototype under
  // `public/legacy` included — a document that can be framed or sniffed is a
  // document someone else can wrap.
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },

  // The vanilla prototype is a static folder in `public/legacy`. Next normalises
  // `/legacy/` to `/legacy`, which matches no route, so point it at the real file.
  // Keeping the prototype under `/legacy/...` keeps its relative asset paths valid.
  async redirects() {
    return [
      {
        source: "/legacy",
        destination: "/legacy/index.html",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
