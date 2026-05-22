// Bridge between Tauri's "task-event" emissions and the task store.
//
// Mount `useTaskEventBridge()` once at the app root; it subscribes to the
// backend's event channel and routes progress + log payloads into the
// matching task by ID.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTaskStore } from "./tasks";

type BackendTaskEvent = {
  taskId: string;
  kind:
    | { tag: "progress"; done: number; total: number }
    | {
        tag: "log";
        level: "info" | "success" | "error";
        message: string;
      };
};

export function useTaskEventBridge() {
  useEffect(() => {
    const unlistenPromise = listen<BackendTaskEvent>("task-event", (ev) => {
      const { taskId, kind } = ev.payload;
      const store = useTaskStore.getState();
      if (kind.tag === "progress") {
        store.setProgress(taskId, kind.done, kind.total);
      } else if (kind.tag === "log") {
        store.appendLog(taskId, {
          at: Date.now(),
          level: kind.level,
          message: kind.message,
        });
      }
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);
}
