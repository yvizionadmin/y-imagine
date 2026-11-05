import { SettingsNav } from "@/features/settings/components/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsNav />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );
}
