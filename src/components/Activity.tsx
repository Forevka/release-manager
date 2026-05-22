import { useState } from "react";
import {
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useTaskStore,
  type LogEntry,
  type Task,
  type TaskStatus,
} from "@/lib/tasks";

// ---------- compact bar (lives at the bottom of the left sidebar) ----------

export function ActivityBar() {
  const tasks = useTaskStore((s) => s.tasks);
  const running = tasks.filter((t) => t.status === "running");
  const lastDone = tasks.find((t) => t.status !== "running");
  const focus = running[0];

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 border-t border-sidebar-border px-3 py-2.5 text-left transition-colors",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          title="Open activity panel"
        >
          <StatusGlyph
            running={running.length > 0}
            lastStatus={lastDone?.status}
          />
          <div className="min-w-0 flex-1">
            {focus ? (
              <CompactRunning task={focus} count={running.length} />
            ) : (
              <CompactIdle lastDone={lastDone} />
            )}
          </div>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-[480px] flex-col gap-0 p-0 sm:max-w-[480px]"
      >
        <ActivityPanel />
      </SheetContent>
    </Sheet>
  );
}

function StatusGlyph({
  running,
  lastStatus,
}: {
  running: boolean;
  lastStatus?: TaskStatus;
}) {
  if (running)
    return (
      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
    );
  if (lastStatus === "success")
    return (
      <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    );
  if (lastStatus === "failed")
    return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  return <ActivityIcon className="size-4 shrink-0 text-muted-foreground" />;
}

function CompactRunning({ task, count }: { task: Task; count: number }) {
  const pct = task.progress
    ? (task.progress.done / Math.max(1, task.progress.total)) * 100
    : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{task.title}</span>
        {task.progress && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {task.progress.done}/{task.progress.total}
          </span>
        )}
      </div>
      {pct !== null ? (
        <Progress value={pct} className="h-1" />
      ) : (
        <p className="text-[10px] text-muted-foreground">running…</p>
      )}
      {count > 1 && (
        <p className="text-[10px] text-muted-foreground">+{count - 1} more</p>
      )}
    </div>
  );
}

function CompactIdle({ lastDone }: { lastDone: Task | undefined }) {
  if (!lastDone) {
    return (
      <div>
        <p className="text-xs font-medium">Activity</p>
        <p className="text-[10px] text-muted-foreground">No tasks yet</p>
      </div>
    );
  }
  return (
    <div>
      <p className="truncate text-xs font-medium">{lastDone.title}</p>
      <p
        className={cn(
          "text-[10px]",
          lastDone.status === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {lastDone.status === "success" ? "done" : "failed"}
      </p>
    </div>
  );
}

// ---------- full panel (slide-out sheet) ----------

function ActivityPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const clearCompleted = useTaskStore((s) => s.clearCompleted);
  const hasCompleted = tasks.some((t) => t.status !== "running");

  return (
    <>
      <SheetHeader className="border-b p-4">
        <SheetTitle>Activity</SheetTitle>
        <SheetDescription>
          What's happening now and what just finished. Tasks are kept until
          you clear them.
        </SheetDescription>
      </SheetHeader>
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {tasks.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              No activity yet. Kick off a Fetch or Check from the Releases tab.
            </p>
          ) : (
            tasks.map((t) => <TaskCard key={t.id} task={t} />)
          )}
        </div>
      </ScrollArea>
      {hasCompleted && (
        <div className="border-t p-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => clearCompleted()}
          >
            <Trash2 className="size-4" />
            Clear completed
          </Button>
        </div>
      )}
    </>
  );
}

function TaskCard({ task }: { task: Task }) {
  const [open, setOpen] = useState(
    task.status === "running" || task.log.length > 0,
  );
  const duration = task.finishedAt
    ? formatDuration(task.finishedAt - task.startedAt)
    : formatDuration(Date.now() - task.startedAt);
  const pct = task.progress
    ? (task.progress.done / Math.max(1, task.progress.total)) * 100
    : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-md border bg-card",
        task.status === "failed" && "border-destructive/40",
      )}
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-3 p-3 text-left",
          "rounded-md transition-colors hover:bg-accent/50",
        )}
      >
        <StatusIconBig status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium">{task.title}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {duration}
            </span>
          </div>
          {task.progress && (
            <div className="mt-1 flex items-center gap-2">
              <Progress
                value={pct ?? 0}
                className={cn(
                  "h-1 flex-1",
                  task.status === "failed" && "bg-destructive/20",
                )}
              />
              <span className="text-xs tabular-nums text-muted-foreground">
                {task.progress.done}/{task.progress.total}
              </span>
            </div>
          )}
          {task.error && (
            <p className="mt-1 text-xs text-destructive">{task.error}</p>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {task.log.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground">
            No log entries yet.
          </p>
        ) : (
          <ul className="space-y-0.5 px-3 pb-3 font-mono text-xs">
            {task.log.map((e, i) => (
              <LogEntryRow key={i} entry={e} />
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.at).toLocaleTimeString();
  return (
    <li className="flex items-start gap-2">
      <span className="shrink-0 text-muted-foreground">{time}</span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          entry.level === "error" && "text-destructive",
          entry.level === "success" && "text-emerald-700 dark:text-emerald-300",
          entry.level === "info" && "text-foreground",
        )}
      >
        {entry.message}
      </span>
    </li>
  );
}

// ---------- shared helpers ----------

function StatusIconBig({ status }: { status: TaskStatus }) {
  switch (status) {
    case "running":
      return (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      );
    case "success":
      return (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      );
    case "failed":
      return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}
