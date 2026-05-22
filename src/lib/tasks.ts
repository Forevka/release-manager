// Activity-bar task store + runTask helper.
//
// Tasks represent long-running operations (fetch repos, check release, bulk
// merge, ...). The store keeps both currently running and recently completed
// tasks so the activity bar can render a "what's going on" view and the
// expanded panel can show a history of what was done.
//
// Backend commands that accept a `taskId` parameter receive a UUID we
// generate up front, then emit `task-event` payloads tagged with that ID.
// A single global listener (mounted in AppShell) routes those events into
// this store.

import { create } from "zustand";

export type TaskKind =
  | "fetch-repos"
  | "check-release"
  | "merge"
  | "bulk-merge"
  | "recheck"
  | "clone"
  | "discover";

export type TaskStatus = "running" | "success" | "failed";

export type LogLevel = "info" | "success" | "error";

export type LogEntry = {
  at: number;
  level: LogLevel;
  message: string;
};

export type TaskProgress = {
  done: number;
  total: number;
};

export type Task = {
  id: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
  progress?: TaskProgress;
  log: LogEntry[];
  error?: string;
};

const MAX_TASKS = 50;

type State = {
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  setProgress: (id: string, done: number, total: number) => void;
  appendLog: (id: string, entry: LogEntry) => void;
  clearCompleted: () => void;
};

export const useTaskStore = create<State>((set) => ({
  tasks: [],
  addTask: (task) =>
    set((s) => {
      // Newest first, cap at MAX_TASKS so the store doesn't grow forever.
      const next = [task, ...s.tasks];
      return { tasks: next.slice(0, MAX_TASKS) };
    }),
  updateTask: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  setProgress: (id, done, total) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, progress: { done, total } } : t,
      ),
    })),
  appendLog: (id, entry) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, log: [...t.log, entry] } : t,
      ),
    })),
  clearCompleted: () =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.status === "running") })),
}));

// ---------- runTask: lifecycle wrapper around a backend invocation ----------

/**
 * Tracks a backend command call as an activity-bar task. The command
 * function receives the generated `taskId` so it can be threaded into the
 * Tauri invoke args (when the backend supports progress events).
 */
export async function runTask<T>(opts: {
  kind: TaskKind;
  title: string;
  command: (taskId: string) => Promise<T>;
}): Promise<T> {
  const id = crypto.randomUUID();
  const store = useTaskStore.getState();
  store.addTask({
    id,
    kind: opts.kind,
    title: opts.title,
    status: "running",
    startedAt: Date.now(),
    log: [],
  });
  try {
    const result = await opts.command(id);
    useTaskStore.getState().updateTask(id, {
      status: "success",
      finishedAt: Date.now(),
    });
    return result;
  } catch (e) {
    useTaskStore.getState().updateTask(id, {
      status: "failed",
      finishedAt: Date.now(),
      error: String(e),
    });
    throw e;
  }
}

/**
 * Run a list of work items as one tracked task, with per-item progress.
 * Used by the frontend-side bulk merge in ReleasesPage.
 */
export async function runBatchTask<TItem, TResult>(opts: {
  kind: TaskKind;
  title: string;
  items: TItem[];
  perItem: (item: TItem) => Promise<{
    result: TResult;
    log: { level: LogLevel; message: string };
    /** Return false to stop the batch (e.g. a conflict that needs human attention). */
    continueAfter?: boolean;
  }>;
}): Promise<TResult[]> {
  const id = crypto.randomUUID();
  const total = opts.items.length;
  const store = useTaskStore.getState();
  store.addTask({
    id,
    kind: opts.kind,
    title: opts.title,
    status: "running",
    startedAt: Date.now(),
    log: [],
    progress: { done: 0, total },
  });
  const results: TResult[] = [];
  try {
    for (let i = 0; i < opts.items.length; i++) {
      const { result, log, continueAfter } = await opts.perItem(opts.items[i]);
      results.push(result);
      const s = useTaskStore.getState();
      s.appendLog(id, { at: Date.now(), ...log });
      s.setProgress(id, i + 1, total);
      if (continueAfter === false) break;
    }
    useTaskStore.getState().updateTask(id, {
      status: "success",
      finishedAt: Date.now(),
    });
    return results;
  } catch (e) {
    useTaskStore.getState().updateTask(id, {
      status: "failed",
      finishedAt: Date.now(),
      error: String(e),
    });
    throw e;
  }
}
