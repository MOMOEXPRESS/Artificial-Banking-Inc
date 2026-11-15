"use client";

import { useState, useEffect, useRef, type ComponentProps } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Expand, X } from "lucide-react";
import { ABMark } from "./brand";
import { ChatView } from "./chat-view";

export function AssistantDock(props: ComponentProps<typeof ChatView> & { currentView: string }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 600px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const update = () => {
      const viewport = window.visualViewport;
      if (!viewport || !panel.current) return;
      panel.current.style.setProperty("--abi-dock-top", `${viewport.offsetTop + 8}px`);
      panel.current.style.setProperty(
        "--abi-dock-height",
        `${Math.max(200, viewport.height - 16)}px`,
      );
    };
    const frame = requestAnimationFrame(update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, mobile]);
  if (props.currentView === "chat") return null;
  const go = (view: string) => {
    setOpen(false);
    props.onGoto(view);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={mobile}>
      <Dialog.Trigger asChild>
        <button type="button" className="abi-assistant-fab" aria-label="Open ABI assistant">
          <span className="abi-assistant-fab-mark" aria-hidden="true">
            <ABMark size={18} tone="#fff" />
          </span>
          <span>Ask ABI</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        {mobile && <Dialog.Overlay className="abi-assistant-overlay" />}
        <Dialog.Content
          ref={panel}
          className="abi-assistant-panel"
          aria-describedby="abi-assistant-description"
          onInteractOutside={(e) => {
            if (!mobile) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            if (mobile) return;
            e.preventDefault();
            document.querySelector<HTMLTextAreaElement>(".abi-assistant-panel textarea")?.focus();
          }}
        >
          <div className="abi-assistant-panel-bar">
            <Dialog.Title>ABI Assistant</Dialog.Title>
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
