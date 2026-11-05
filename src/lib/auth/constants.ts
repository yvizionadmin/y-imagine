// Shared with the proxy, so no server-only imports here.
export const SESSION_COOKIE = "imagine_session";
/** The org picked in the switcher when Clerk owns the session (local sessions store it in the DB). */
export const ORG_COOKIE = "imagine_org";

/** Clerk owns sign-in when both keys are set; otherwise the local password login runs (dev, demo, tests). */
export const clerkEnabled = () => !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
