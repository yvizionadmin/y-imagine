"use client";

import { Fragment, useSyncExternalStore, type ReactNode } from "react";

// Next keeps recently visited pages alive (Activity), so a tool reopened from "New Job" would still
// show the last job's form and result. Each "New Job" bumps this counter, and NewJobScope keys the
// pages on it, so every tool starts fresh. Rail links and back/forward still keep work in progress.
let job = 0;
const listeners = new Set<() => void>();

export function startNewJob() {
  job += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function NewJobScope({ children }: { children: ReactNode }) {
  const key = useSyncExternalStore(subscribe, () => job, () => 0);
  return <Fragment key={key}>{children}</Fragment>;
}
