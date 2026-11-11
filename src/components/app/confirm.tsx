"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/** What the confirm button says: Delete and Remove are shown as dangerous; Continue is not. */
export type ConfirmAction = "delete" | "remove" | "continue";
type Request = { message: string; action: ConfirmAction; resolve: (ok: boolean) => void };

let show: ((request: Request) => void) | null = null;

/**
 * Asks the user to confirm in the app's own dialog (U5) instead of the browser's `window.confirm`: the question,
 * Cancel, and a button named for the action. Resolves true only when they press it; Escape, Cancel or the backdrop
 * resolve false. Falls back to the browser's confirm where no `ConfirmHost` is mounted.
 */
export function confirmAction(message: string, action: ConfirmAction = "delete"): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => show!({ message, action, resolve }));
}

/** Mounted once per shell (app and console layouts); shows the dialog for `confirmAction`. */
export function ConfirmHost() {
  const t = useTranslations("Shell.confirm");
  const [request, setRequest] = useState<Request | null>(null);
  const current = useRef<Request | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    show = (next) => {
      current.current?.resolve(false); // a newer question replaces an unanswered one
      current.current = next;
      setRequest(next);
    };
    return () => {
      show = null;
    };
  }, []);

  function answer(ok: boolean) {
    current.current?.resolve(ok);
    current.current = null;
    setRequest(null);
  }

  const danger = request?.action !== "continue";
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent showCloseButton={false} initialFocus={cancelRef} className="font-sans sm:max-w-md">
        <DialogTitle dir="auto" className="text-start text-[15px] leading-snug font-semibold">
          {request?.message}
        </DialogTitle>
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="outline" onClick={() => answer(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={() => answer(true)} className={cn(danger && "bg-danger text-white hover:bg-danger/90")}>
            {request ? t(request.action) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
