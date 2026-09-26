import { cookies } from "next/headers";
import { ChatShell } from "@/components/chat/chat-shell";

export default async function Page() {
  const cookieStore = await cookies();
  const collapsed = cookieStore.get("sidebar_state")?.value === "collapsed";
  return <ChatShell initialSidebarCollapsed={collapsed} />;
}
