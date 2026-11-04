import { NextResponse, type NextRequest } from "next/server";

// Public routes: login, tracking endpoints, unsubscribe and booking pages, booking webhooks, health check.
const PUBLIC = [/^\/login/, /^\/t\//, /^\/u\//, /^\/b\//, /^\/api\/meetings\//, /^\/api\/health/, /^\/api\/cron\//, /^\/_next\//, /^\/favicon/, /^\/icon/, /^\/logo\.png$/];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  // Full signature check happens on the server in every page and route (requireUser/getSession)
  if (req.cookies.get("yc_session")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
