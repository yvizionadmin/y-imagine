import { SettingsNav } from "@/features/settings/components/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <SettingsNav />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
