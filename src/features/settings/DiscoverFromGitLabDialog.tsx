import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  cloneProject,
  createGroup,
  createRepository,
  detectLocalClone,
  listGitlabGroupProjects,
  pickDirectory,
} from "@/lib/api";
import { runTask } from "@/lib/tasks";
import type { GitLabProject } from "@/lib/types";
import { cn } from "@/lib/utils";

type CloneTransport = "ssh" | "https";

type DiscoveryRow = {
  project: GitLabProject;
  included: boolean;
  localPath: string | null;
  cloning: boolean;
  cloneError: string | null;
};

const DEFAULT_RELEASE_BRANCH = "UAT";
const DEFAULT_PROD_BRANCH = "main";

export function DiscoverFromGitLabDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [appGroupName, setAppGroupName] = useState("");
  const [jiraKey, setJiraKey] = useState("");
  const [groupPath, setGroupPath] = useState("");
  const [baseDir, setBaseDir] = useState("");
  const [includeSubgroups, setIncludeSubgroups] = useState(true);
  const [transport, setTransport] = useState<CloneTransport>("ssh");
  const [rows, setRows] = useState<DiscoveryRow[] | null>(null);

  const canDiscover = groupPath.trim().length > 0 && baseDir.trim().length > 0;

  // ---------- discover (list + match) ----------

  const discover = useMutation({
    mutationFn: async () => {
      const projects = await runTask({
        kind: "discover",
        title: `Discover · ${groupPath}`,
        command: () =>
          listGitlabGroupProjects(groupPath, includeSubgroups),
      });
      // Match each against the base directory in parallel.
      const matched = await Promise.all(
        projects.map(async (p) => {
          const localPath = await detectLocalClone(
            baseDir,
            p.pathWithNamespace,
          ).catch(() => null);
          return {
            project: p,
            included: !p.archived && localPath !== null,
            localPath,
            cloning: false,
            cloneError: null,
          } satisfies DiscoveryRow;
        }),
      );
      return matched;
    },
    onSuccess: (matched) => {
      setRows(matched);
      if (!appGroupName.trim()) {
        // Default the app group name to the last segment of the GitLab
        // group path. "devcom/subteam" → "subteam".
        const guess = groupPath.split("/").filter(Boolean).pop() ?? "";
        setAppGroupName(guess);
      }
      const total = matched.length;
      const found = matched.filter((r) => r.localPath).length;
      toast.success(`Found ${total} projects (${found} matched locally)`);
    },
    onError: (e) => toast.error(`Discovery failed: ${e}`),
  });

  // ---------- per-row clone ----------

  const updateRow = (id: number, patch: Partial<DiscoveryRow>) => {
    setRows((prev) =>
      prev
        ? prev.map((r) => (r.project.id === id ? { ...r, ...patch } : r))
        : prev,
    );
  };

  const cloneRow = async (row: DiscoveryRow) => {
    if (!baseDir) return;
    const url =
      transport === "ssh"
        ? row.project.sshUrlToRepo
        : row.project.httpUrlToRepo;
    const target = joinPath(baseDir, row.project.pathWithNamespace);
    updateRow(row.project.id, { cloning: true, cloneError: null });
    try {
      const res = await runTask({
        kind: "clone",
        title: `Clone ${row.project.pathWithNamespace}`,
        command: () => cloneProject(url, target),
      });
      updateRow(row.project.id, {
        cloning: false,
        localPath: res.targetPath,
        included: true,
        cloneError: null,
      });
    } catch (e) {
      updateRow(row.project.id, {
        cloning: false,
        cloneError: String(e),
      });
      toast.error(`Clone ${row.project.name} failed: ${e}`);
    }
  };

  const cloneAllMissing = async () => {
    if (!rows) return;
    const missing = rows.filter((r) => r.included && r.localPath === null);
    for (const r of missing) {
      await cloneRow(r);
    }
  };

  // ---------- save ----------

  const save = useMutation({
    mutationFn: async () => {
      if (!rows) throw new Error("Run Discover first");
      const includable = rows.filter(
        (r) => r.included && r.localPath !== null,
      );
      if (includable.length === 0) {
        throw new Error("No repositories selected with a local path");
      }
      const group = await createGroup({
        name: appGroupName.trim(),
        jiraProjectKey: jiraKey.trim() || null,
        defaultReleaseBranch: DEFAULT_RELEASE_BRANCH,
        defaultProdBranch: DEFAULT_PROD_BRANCH,
        gitTimeoutSeconds: 60,
        maxRetries: 3,
      });
      for (const r of includable) {
        await createRepository({
          groupId: group.id,
          name: r.project.name,
          path: r.localPath!,
          releaseBranch: null,
          prodBranch: null,
        });
      }
      return { group, count: includable.length };
    },
    onSuccess: ({ count }) => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success(`Created app group with ${count} repo(s)`);
      onClose();
    },
    onError: (e) => toast.error(`Save failed: ${e}`),
  });

  const totals = useMemo(() => summarize(rows), [rows]);
  const canSave =
    rows !== null &&
    appGroupName.trim().length > 0 &&
    totals.includedWithPath > 0 &&
    !save.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[85vh] w-[80vw] max-w-[80vw] flex-col gap-4 overflow-hidden sm:max-w-[80vw]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Discover from GitLab</DialogTitle>
          <DialogDescription>
            Point at a GitLab group, pick a base directory, and the app will
            match each project to a local clone (or offer to clone it).
            Hit Save to create the app group with the selected repos.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 overflow-y-auto px-6 py-2">
          <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field id="gl-app-name" label="App group name">
              <Input
                id="gl-app-name"
                placeholder="defaults to GitLab group's last segment"
                value={appGroupName}
                onChange={(e) => setAppGroupName(e.target.value)}
              />
            </Field>
            <Field id="gl-jira" label="Jira project key (optional)">
              <Input
                id="gl-jira"
                placeholder="e.g. KEYS"
                value={jiraKey}
                onChange={(e) => setJiraKey(e.target.value)}
              />
            </Field>
          </div>

          <Field
            id="gl-group"
            label="GitLab group path"
            hint='e.g. "devcom" or "devcom/subteam"'
          >
            <Input
              id="gl-group"
              placeholder="devcom"
              value={groupPath}
              onChange={(e) => setGroupPath(e.target.value)}
            />
          </Field>

          <Field
            id="gl-base"
            label="Base local directory"
            hint="Where to look for / clone repositories"
          >
            <div className="flex gap-2">
              <Input
                id="gl-base"
                placeholder="C:\\sources\\repos"
                value={baseDir}
                onChange={(e) => setBaseDir(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const picked = await pickDirectory(
                    "Select base directory for clones",
                  );
                  if (picked) setBaseDir(picked);
                }}
              >
                <FolderOpen className="size-4" />
                Browse
              </Button>
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={includeSubgroups}
                onCheckedChange={setIncludeSubgroups}
              />
              Include subgroups
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span>Clone via</span>
              <Select
                value={transport}
                onValueChange={(v) => setTransport(v as CloneTransport)}
              >
                <SelectTrigger className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto">
              <Button
                onClick={() => discover.mutate()}
                disabled={!canDiscover || discover.isPending}
              >
                {discover.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Discover
              </Button>
            </div>
          </div>

          {rows !== null && (
            <DiscoveryResults
              rows={rows}
              totals={totals}
              onToggle={(id, included) => updateRow(id, { included })}
              onClone={cloneRow}
              onCloneAllMissing={cloneAllMissing}
              onPickPath={async (id) => {
                const picked = await pickDirectory(
                  "Pick local clone for this project",
                );
                if (picked) updateRow(id, { localPath: picked });
              }}
            />
          )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave}>
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Save {totals.includedWithPath > 0 ? `${totals.includedWithPath} ` : ""}repo
            {totals.includedWithPath === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- discovery results table ----------

function DiscoveryResults({
  rows,
  totals,
  onToggle,
  onClone,
  onCloneAllMissing,
  onPickPath,
}: {
  rows: DiscoveryRow[];
  totals: Totals;
  onToggle: (id: number, included: boolean) => void;
  onClone: (row: DiscoveryRow) => void;
  onCloneAllMissing: () => void;
  onPickPath: (id: number) => void;
}) {
  const missingClonesCount = rows.filter(
    (r) => r.included && r.localPath === null && !r.cloning,
  ).length;

  return (
    <div className="space-y-2 rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{totals.total} found</Badge>
          <Badge
            variant="outline"
            className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
          >
            {totals.matched} matched
          </Badge>
          {totals.missing > 0 && (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
            >
              {totals.missing} need clone
            </Badge>
          )}
          {totals.archived > 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              {totals.archived} archived
            </Badge>
          )}
        </div>
        {missingClonesCount > 0 && (
          <Button size="sm" variant="outline" onClick={onCloneAllMissing}>
            <Download className="size-3" />
            Clone {missingClonesCount} missing
          </Button>
        )}
      </div>

      <ul className="divide-y">
        {rows.map((row) => (
          <RowItem
            key={row.project.id}
            row={row}
            onToggle={(v) => onToggle(row.project.id, v)}
            onClone={() => onClone(row)}
            onPickPath={() => onPickPath(row.project.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function RowItem({
  row,
  onToggle,
  onClone,
  onPickPath,
}: {
  row: DiscoveryRow;
  onToggle: (v: boolean) => void;
  onClone: () => void;
  onPickPath: () => void;
}) {
  const status = rowStatus(row);
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2">
      <Checkbox
        checked={row.included}
        onCheckedChange={(v) => onToggle(Boolean(v))}
        disabled={row.project.archived}
        aria-label={`Include ${row.project.name}`}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {row.project.name}
          </span>
          {row.project.archived && (
            <Badge variant="outline" className="text-muted-foreground">
              archived
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{row.project.pathWithNamespace}</span>
          {row.localPath && (
            <>
              {" → "}
              <span className="font-mono">{row.localPath}</span>
            </>
          )}
        </div>
        {row.cloneError && (
          <p className="mt-1 text-xs text-destructive">{row.cloneError}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
        {row.localPath === null && !row.cloning && !row.project.archived && (
          <Button size="sm" variant="outline" onClick={onClone}>
            <Download className="size-3" />
            Clone
          </Button>
        )}
        {row.cloning && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <Button
          size="sm"
          variant="ghost"
          onClick={onPickPath}
          title="Pick a different local path"
        >
          <FolderOpen className="size-3" />
        </Button>
      </div>
    </li>
  );
}

type RowStatus = "matched" | "needs-clone" | "archived" | "cloning";

function rowStatus(row: DiscoveryRow): RowStatus {
  if (row.cloning) return "cloning";
  if (row.project.archived) return "archived";
  if (row.localPath) return "matched";
  return "needs-clone";
}

function StatusBadge({ status }: { status: RowStatus }) {
  switch (status) {
    case "matched":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-emerald-300 bg-emerald-50 text-emerald-800",
            "dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
          )}
        >
          <CheckCircle2 className="size-3" />
          matched
        </Badge>
      );
    case "needs-clone":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
        >
          <AlertTriangle className="size-3" />
          needs clone
        </Badge>
      );
    case "cloning":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          cloning…
        </Badge>
      );
    case "archived":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          archived
        </Badge>
      );
  }
}

// ---------- summary + helpers ----------

type Totals = {
  total: number;
  matched: number;
  missing: number;
  archived: number;
  includedWithPath: number;
};

function summarize(rows: DiscoveryRow[] | null): Totals {
  const t: Totals = {
    total: 0,
    matched: 0,
    missing: 0,
    archived: 0,
    includedWithPath: 0,
  };
  if (!rows) return t;
  t.total = rows.length;
  for (const r of rows) {
    if (r.project.archived) t.archived++;
    else if (r.localPath) t.matched++;
    else t.missing++;
    if (r.included && r.localPath) t.includedWithPath++;
  }
  return t;
}

function joinPath(base: string, rel: string): string {
  // Windows-friendly join: keep the base's separator, append normalized rel.
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const trimmedBase = base.replace(/[\\/]+$/, "");
  const normalizedRel = rel.replace(/\//g, sep);
  return `${trimmedBase}${sep}${normalizedRel}`;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
