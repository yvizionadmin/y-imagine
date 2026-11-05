import { LooksTabs } from "@/features/looks/components/looks-tabs";

export default function LooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <LooksTabs />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
