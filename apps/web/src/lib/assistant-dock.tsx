"use client";

import { useState, type ComponentProps } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Expand, X } from "lucide-react";
import { ABMark } from "./brand";
import { ChatView } from "./chat-view";

export function AssistantDock(props: ComponentProps<typeof ChatView> & { currentView: string }) {
  const [open, setOpen] = useState(false);
  if (props.currentView === "chat") return null;
  const go = (view: string) => {
    setOpen(false);
    props.onGoto(view);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Trigger asChild>
        <button type="button" className="abi-assistant-fab" aria-label="Open ABI assistant">
          <span className="abi-assistant-fab-mark" aria-hidden="true">
            <ABMark size={18} tone="#fff" />
          </span>
          <span>Ask ABI</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          className="abi-assistant-panel"
          aria-describedby="abi-assistant-description"
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLTextAreaElement>(".abi-assistant-panel textarea")?.focus();
          }}
        >
          <div className="abi-assistant-panel-bar">
            <Dialog.Title>Ask ABI</Dialog.Title>
            <div>
              <button
                type="button"
                className="abi-chat-icon"
                aria-label="Open full conversation"
                onClick={() => go("chat")}
              >
                <Expand size={16} />
              </button>
              <Dialog.Close className="abi-chat-icon" aria-label="Close Assistant">
                <X size={18} />
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description id="abi-assistant-description" className="sr-only">
            Browse the marketplace and manage spending questions without leaving this page. Escape
            closes the conversation panel.
          </Dialog.Description>
          <ChatView {...props} compact onGoto={go} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
