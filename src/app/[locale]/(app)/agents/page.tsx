import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AgentWorkspace } from "@/features/agents/components/agent-workspace";

export default async function AgentsPage({ params }: PageProps<"/[locale]/agents">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // useSearchParams (?run=) is request data.
    <Suspense>
      <AgentWorkspace />
    </Suspense>
  );
}
