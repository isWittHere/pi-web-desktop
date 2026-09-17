import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import { isValidBasicAuthorization, isWebPasswordEnabled } from "@/lib/web-auth";
import {
  getAuthRetryAfterMs,
  recordAuthFailure,
  recordAuthSuccess,
  retryAfterSeconds,
} from "@/lib/auth-throttle";

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const trusted = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!trusted) {
    return isApiRequest
      ? NextResponse.json({ error: "Untrusted API request" }, { status: 403 })
      : new NextResponse("Untrusted request", { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (isWebPasswordEnabled(password)) {
    const authorization = request.headers.get("authorization") ?? null;
    const hasAttempt = authorization !== null;
    // Only a request that actually carries credentials is a password attempt;
    // a first page load without a header is not throttled nor counted.
    if (hasAttempt) {
      const retryAfterMs = getAuthRetryAfterMs();
      if (retryAfterMs > 0) {
        return new NextResponse("Too many failed attempts", {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(retryAfterSeconds(retryAfterMs)),
          },
        });
      }
      if (isValidBasicAuthorization(authorization, password)) {
        recordAuthSuccess();
        return NextResponse.next();
      }
      const delayMs = recordAuthFailure();
      return new NextResponse("Authentication required", {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
          "Retry-After": String(retryAfterSeconds(delayMs)),
        },
      });
    }
    // No credentials supplied: prompt, without treating it as a failure.
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
