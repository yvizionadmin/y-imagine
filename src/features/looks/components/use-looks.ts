"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { deleteLook, getLooks, setLookBoard, type LookView } from "../actions";
import type { LookMenuActions } from "./look-menu";

/** Saved looks plus the delete / board-toggle actions shared by Mood Boards and History. */
export function useLooks() {
  const t = useTranslations("Looks");
  const [looks, setLooks] = useState<LookView[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLooks().then((result) => {
      setLooks(result.looks);
      setCanEdit(result.canEdit);
    });
  }, []);

  const replace = (look: LookView) => setLooks((all) => all?.map((l) => (l.id === look.id ? look : l)) ?? null);

  const actions: Omit<LookMenuActions, "onDetails"> = {
    async onToggleBoard(look) {
      setError(null);
      const response = await setLookBoard(look.id, !look.isBoard);
      if (response.ok) replace({ ...look, isBoard: !look.isBoard });
      else setError(t(response.error === "forbidden" ? "forbidden" : "notFound"));
    },
    async onDelete(look) {
      if (!window.confirm(t("deleteConfirm", { name: look.title }))) return;
      setError(null);
      const response = await deleteLook(look.id);
      if (response.ok || response.error === "not_found") setLooks((all) => all?.filter((l) => l.id !== look.id) ?? null);
      else setError(t("forbidden"));
    },
  };

  return { looks, canEdit, error, setError, replace, actions };
}
