import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ChatWorkspace } from "@/features/chat/components/chat-workspace";

export default async function ChatPage({ params }: PageProps<"/[locale]/chat">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    // useSearchParams (?thread=) is request data.
    <Suspense>
      <ChatWorkspace />
    </Suspense>
  );
}
