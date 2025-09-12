"use client";

import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";
import { useSidebar } from "@/components/ui/sidebar";

export function ChatFooterBar({
  rightOpen,
  onSendMessage,
  disabled,
  availableProviders,
}: {
  rightOpen: boolean;
  onSendMessage: (text: string, options?: any) => void;
  disabled?: boolean;
  availableProviders: string[];
}) {
  const { state } = useSidebar();
  
  return (
    <div
      className={cn(
        "fixed bottom-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-[left,right] duration-200 ease-linear",
        // Use sidebar state directly
        state === "expanded" ? "md:left-[var(--sidebar-width)]" : "md:left-[var(--sidebar-width-icon)]",
        // Mirror right sidebar by shifting right edge when open
        rightOpen ? "md:right-[var(--sidebar-width)]" : "md:right-0"
      )}
    >
      <div className="w-full p-4">
        <ChatInput
          onSendMessage={onSendMessage}
          disabled={!!disabled}
          availableProviders={availableProviders}
        />
      </div>
    </div>
  );
}


