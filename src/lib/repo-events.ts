// Listens for backend `repo-changed` events emitted by the file watcher
// and delivers them to the caller with per-repo debouncing.
//
// The backend already debounces inside its watcher (300 ms), but events
// from different rapid git operations (e.g. `merge` followed by `commit`)
// can still arrive close together. We coalesce a second 500 ms here so a
// single sequence of git work produces exactly one recheck on the
// frontend side.

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

type RepoChangedPayload = { repoId: string };

const DEBOUNCE_MS = 500;

export function useRepoChanged(callback: (repoId: string) => void) {
  // Keep the latest callback in a ref so we don't have to resubscribe every
  // render and risk dropping events.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const unlistenPromise = listen<RepoChangedPayload>("repo-changed", (ev) => {
      const repoId = ev.payload.repoId;
      const existing = timers.get(repoId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(repoId);
        cbRef.current(repoId);
      }, DEBOUNCE_MS);
      timers.set(repoId, t);
    });

    return () => {
      unlistenPromise.then((fn) => fn());
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);
}
