import { Suspense } from "react";
import { IconRail } from "@/components/app/icon-rail";
import { NewJobScope } from "@/components/app/new-job";
import { OrgCatalogInit, OrgCatalogProvider } from "@/components/app/org-catalog";
import { TopBar } from "@/components/app/top-bar";
import { ViewAsBanner } from "@/features/admin/components/view-as-banner";
import { getOrgCatalog } from "@/lib/catalog/org-catalog";
import { getWorkspace } from "@/lib/workspace";

// The session is read at request time, so the shell chrome streams in behind Suspense while the
// page itself stays prerenderable (Cache Components).
export default function AppLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Suspense>
        <SignedInViewAs />
      </Suspense>
      <Suspense fallback={<div className="h-topbar shrink-0 bg-topbar" />}>
        <SignedInTopBar />
      </Suspense>
      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<IconRail isSuperAdmin={false} />}>
          <SignedInRail />
        </Suspense>
        {/* A tool page with the prompt dock scrolls as a column: results, then the Studio-style hero. Other pages keep the row. */}
        {/* Once editing starts (data-touched) or there is a results feed (data-feed), the "will appear here" placeholder
            collapses. */}
        <main
          className={[
            "flex min-w-0 flex-1 bg-canvas has-[[data-dock]]:flex-col has-[[data-dock]]:overflow-y-auto",
            "[&:has([data-touched])_[data-empty-state]]:hidden [&:has([data-touched])>section:has(>div>[data-empty-state])]:hidden",
            "[&:has([data-feed])_[data-empty-state]]:hidden [&:has([data-feed])>section:has(>div>[data-empty-state])]:hidden",
          ].join(" ")}
        >
          <OrgCatalogProvider>
            <Suspense>
              <SignedInCatalog />
            </Suspense>
            <NewJobScope>{children}</NewJobScope>
          </OrgCatalogProvider>
        </main>
      </div>
    </div>
  );
}

async function SignedInViewAs() {
  const { viewAs, orgName } = await getWorkspace();
  return viewAs ? <ViewAsBanner orgName={orgName} expiresAt={viewAs.expiresAt} /> : null;
}

async function SignedInTopBar() {
  return <TopBar workspace={await getWorkspace()} />;
}

async function SignedInRail() {
  const { isSuperAdmin } = await getWorkspace();
  return <IconRail isSuperAdmin={isSuperAdmin} />;
}

async function SignedInCatalog() {
  const { orgId } = await getWorkspace();
  return <OrgCatalogInit catalog={await getOrgCatalog(orgId)} />;
}
