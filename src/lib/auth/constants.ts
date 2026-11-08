// Shared with the proxy, so no server-only imports here.
export const SESSION_COOKIE = "imagine_session";
/** The org picked in the switcher when Clerk owns the session (local sessions store it in the DB). */
export const ORG_COOKIE = "imagine_org";
/** A super admin's read-only view of an org. Verified in src/lib/auth/view-as.ts; the proxy only checks it is there. */
export const VIEW_AS_COOKIE = "imagine_view_as";

/** Clerk owns sign-in when both keys are set; otherwise the local password login runs (dev, demo, tests). */
export const clerkEnabled = () => !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
