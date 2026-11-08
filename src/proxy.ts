import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { clerkEnabled, SESSION_COOKIE } from "./lib/auth/constants";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

// Pages reachable without a session. The check here is only a fast redirect; the session itself is
// validated server-side by getWorkspace() / requireSuperAdmin().
const PUBLIC = /^\/(?:(en|ar)(?=\/|$))?\/?(sign-in|sign-up|forgot-password|reset-password|blocked|features|pricing|terms|privacy)?\/?$/;

function route(request: NextRequest, signedIn: boolean) {
  const { pathname, search } = request.nextUrl;
  // API routes authenticate themselves; they only pass through here so Clerk can read the session.
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const match = PUBLIC.exec(pathname);
  const isPublic = !!match?.[2];
  const isRoot = !!match && !match[2];

  // The home page is the marketing site for visitors; people with a session go straight to the Studio.
  if (isRoot && signedIn && match[1]) return NextResponse.redirect(new URL(`/${match[1]}/home${search}`, request.url));

  if (!isPublic && !isRoot && !signedIn) {
    const locale = routing.locales.find((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)) ?? routing.defaultLocale;
    const url = new URL(`/${locale}/sign-in`, request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return intl(request);
}

// With Clerk keys, Clerk's middleware verifies its session cookie (auth() needs it to have run);
// otherwise the local session cookie is checked.
const clerk = clerkEnabled() ? clerkMiddleware(async (auth, request) => route(request, !!(await auth()).userId)) : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerk ? clerk(request, event) : route(request, request.cookies.has(SESSION_COOKIE));
}

export const config = {
  // Skip Next internals and files with an extension (images, favicon, ...)
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)", "/api/(.*)"],
};
