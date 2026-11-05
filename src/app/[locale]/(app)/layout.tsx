import { Suspense } from "react";
import { IconRail } from "@/components/app/icon-rail";
import { NewJobScope } from "@/components/app/new-job";
import { TopBar } from "@/components/app/top-bar";
import { getWorkspace } from "@/lib/workspace";

// The session is read at request time, so the shell chrome streams in behind Suspense while the
// page itself stays prerenderable (Cache Components).
export default function AppLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Suspense fallback={<div className="h-topbar shrink-0 bg-topbar" />}>
        <SignedInTopBar />
      </Suspense>
      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<IconRail isSuperAdmin={false} />}>
          <SignedInRail />
        </Suspense>
        <main className="flex min-w-0 flex-1 bg-canvas">
          <NewJobScope>{children}</NewJobScope>
        </main>
      </div>
    </div>
  );
}

async function SignedInTopBar() {
  return <TopBar workspace={await getWorkspace()} />;
}

async function SignedInRail() {
  const { isSuperAdmin } = await getWorkspace();
  return <IconRail isSuperAdmin={isSuperAdmin} />;
}
