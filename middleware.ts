import { NextResponse, type NextRequest } from "next/server";

import { decideAccess } from "@/lib/supabase/guard";
import { refreshSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user, isConfigured } = await refreshSession(request);

  const decision = decideAccess({
    hasUser: user !== null,
    isConfigured,
    pathname: request.nextUrl.pathname,
  });

  if (decision === "allow") {
    return response;
  }

  const target = request.nextUrl.clone();
  target.pathname =
    decision === "redirect:/postavljanje" ? "/postavljanje" : "/prijava";
  target.search = "";
  return NextResponse.redirect(target);
}

export const config = {
  // Deliberately narrow: never runs on /legacy or static assets.
  matcher: ["/workspace/:path*", "/prijava"],
};
