// Catch-all BFF route. Forwards any /api/* request to the invoq-api,
// injecting the session's API key. Keeps the secret key server-side and
// out of the browser bundle.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/app/lib/config";
import { getErrorMessage } from "@/app/lib/errors";

async function handle(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const subPath = (path ?? []).join("/");
  const upstreamPath = subPath === "health" ? "/health" : `/v1/${subPath}`;
  const url = `${API_BASE_URL}${upstreamPath}${req.nextUrl.search}`;

  // Auth gate: signup, login, health, and aggregate platform stats are public; everything
  // else needs the invoq_session cookie.
  const isPublic =
    subPath === "developers/signup" ||
    subPath === "developers/login"  ||
    subPath === "stats"             ||
    subPath === "health";

  const store = await cookies();
  const apiKey = store.get("invoq_session")?.value;

  if (!isPublic && !apiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const headers = new Headers();
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  // Pass a small allowlist of headers upstream — not the cookie itself.
  const accept = req.headers.get("accept");
  if (accept) headers.set("Accept", accept);

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const text = await req.text();
    if (text) body = text;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method:  req.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Upstream unreachable: ${getErrorMessage(err, String(err))}` },
      { status: 502 },
    );
  }

  // Pipe upstream response back. Set-cookie for the auth cookie is handled
  // by the dedicated /api/auth routes — not the BFF.
  const resHeaders = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) resHeaders.set("Content-Type", ct);

  // On /developers/login, the upstream returns the secret key. We mint
  // the cookie here and strip the plaintext from the response.
  if (subPath === "developers/login" && upstream.ok) {
    const data = await upstream.json().catch(() => null);
    if (data?.secretKey) {
      const response = NextResponse.json({
        developerId:    data.developerId,
        stellarAddress: data.stellarAddress,
        email:          data.email,
        name:           data.name,
        keyId:          data.keyId,
        env:            data.env,
      });
      response.cookies.set("invoq_session", data.secretKey, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        // 30 days
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }
  }

  // On /developers/signup, the upstream returns the secret key for first-time
  // creation. Pass it through (the client stores it AND we set the cookie).
  if (subPath === "developers/signup" && upstream.ok) {
    const data = await upstream.json().catch(() => null);
    if (data?.secretKey) {
      const response = NextResponse.json(data);
      response.cookies.set("invoq_session", data.secretKey, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }
  }

  // Generic proxy
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export const GET    = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
export const POST   = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
export const PATCH  = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
export const PUT    = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => handle(req, ctx.params);
