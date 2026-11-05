"use client";

import { useEffect, useState } from "react";
import type { ImageBatchTool } from "@/lib/image-batch/rows";
import type { ImageBatchItemView, ImageBatchView } from "@/lib/image-batch/start";
import { getImageBatchRun, listImageBatchRuns } from "../actions";

export type OpenImageRun = { batch: ImageBatchView; items: ImageBatchItemView[] };

const POLL_MS = 3000;

/** A tool's recent runs and the open one, refreshed every few seconds while it is running. */
export function useImageRuns(tool: ImageBatchTool) {
  const [runs, setRuns] = useState<ImageBatchView[]>([]);
  const [open, setOpen] = useState<OpenImageRun | null>(null);

  useEffect(() => {
    listImageBatchRuns(tool).then(setRuns);
  }, [tool]);

  const openId = open?.batch.id;
  const running = open?.batch.status === "running";
  useEffect(() => {
    if (!openId || !running) return;
    const timer = setInterval(async () => {
      const fresh = await getImageBatchRun(openId);
      if (!fresh) return;
      setOpen(fresh);
      setRuns((r) => r.map((b) => (b.id === openId ? fresh.batch : b)));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [openId, running]);

  /** Opens a run and refreshes its row in the list (a fast run may finish before the first poll). */
  async function show(id: string) {
    const run = await getImageBatchRun(id);
    if (!run) return;
    setOpen(run);
    setRuns((r) => r.map((b) => (b.id === id ? run.batch : b)));
  }

  return {
    runs,
    open,
    show,
    /** A run just started: list it first and open it. */
    started: (batch: ImageBatchView) => {
      setRuns((r) => [batch, ...r]);
      show(batch.id);
    },
    changed: (run: OpenImageRun | null) => {
      if (!run) return;
      setOpen(run);
      setRuns((r) => r.map((b) => (b.id === run.batch.id ? run.batch : b)));
    },
    deleted: (id: string) => {
      setOpen(null);
      setRuns((r) => r.filter((b) => b.id !== id));
    },
  };
}
