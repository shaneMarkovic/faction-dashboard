import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/session-crypto";

export const SESSION_COOKIE = "tw_session";

/**
 * Access gate: every page requires a valid session cookie (a Torn key verified
 * as belonging to a tracked faction — see /gate). Unauthenticated requests are
 * redirected to /gate. The userscript and static assets stay public (the
 * matcher excludes them) so Tampermonkey can fetch the script without a login.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, process.env.SESSION_SECRET ?? "");
  if (session) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except: the gate page, Next internals, the public
  // userscript, and common static files.
  matcher: ["/((?!gate|_next/static|_next/image|favicon.ico|torn-ops-enforcer.user.js).*)"],
};
