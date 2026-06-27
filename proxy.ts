import { NextResponse, type NextRequest } from "next/server";

// Lightweight auth gate. The actual /v1/developers/me check happens inside
// each protected page via getSession() — the proxy here just sends users
// without a cookie to /login.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/dashboard")) return NextResponse.next();

  const cookie = req.cookies.get("invoq_session")?.value;
  if (cookie) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
