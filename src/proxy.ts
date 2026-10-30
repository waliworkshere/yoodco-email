import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Public routes: login, tracking endpoints, unsubscribe page, health check.
const PUBLIC = [/^\/login/, /^\/t\//, /^\/u\//, /^\/api\/health/, /^\/_next\//, /^\/favicon/];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const token = req.cookies.get("yc_session")?.value;
  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET));
      return NextResponse.next();
    } catch {
      /* fall through to login */
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
