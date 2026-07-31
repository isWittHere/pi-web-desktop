import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import { isValidBasicAuthorization, isWebPasswordEnabled } from "@/lib/web-auth";

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
  if (isWebPasswordEnabled(password) && !isValidBasicAuthorization(request.headers.get("authorization"), password)) {
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
