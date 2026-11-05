import { Suspense } from "react";
import { AdminNav, AdminTopBar } from "@/features/admin/components/admin-ui";
import { requireSuperAdmin } from "@/lib/workspace";

// Platform console for super admins. Not org-scoped, so it has its own shell instead of (app)'s.
export default function AdminLayout({ children }: LayoutProps<"/[locale]/admin">) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Suspense fallback={<div className="h-topbar shrink-0 bg-topbar" />}>
        <SignedInTopBar />
      </Suspense>
      <div className="flex min-h-0 flex-1">
        <AdminNav />
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          <Suspense>
            <Gate>{children}</Gate>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

async function SignedInTopBar() {
  return <AdminTopBar user={await requireSuperAdmin()} />;
}

/** Page content only renders for super admins (each action re-checks too). */
async function Gate({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin();
  return children;
}
