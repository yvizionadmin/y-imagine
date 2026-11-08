import { SettingsNav } from "@/features/settings/components/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <SettingsNav />
      {/* Focusable so the keyboard can scroll it on pages with no controls. */}
      <div tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
        {children}
      </div>
    </div>
  );
}
