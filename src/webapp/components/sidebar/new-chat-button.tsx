import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewChatButton({ onClick, collapsed }: { onClick: () => void; collapsed: boolean }) {
  return (
    <Button variant="outline" size={collapsed ? "icon" : "default"} onClick={onClick} className="w-full justify-start gap-2">
      <SquarePen className="h-4 w-4 shrink-0" />
      {!collapsed && <span>New chat</span>}
    </Button>
  );
}
