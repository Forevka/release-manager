import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  Download,
  ExternalLink,
  FolderOpen,
  GitMerge,
  Loader2,
  Minus,
  Play,
  RotateCw,
  Tag,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  checkRelease,
  clearWatchedRepos,
  fetchRepos,
  listBranchTags,
  listGroups,
  listJiraVersions,
  listRepositories,
  mergeBranch,
  openInExplorer,
  openInMergeTool,
  recheckRepoCells,
  setBranchTag,
  watchGroupRepos,
} from "@/lib/api";
import { useRepoChanged } from "@/lib/repo-events";
import { runBatchTask, runTask } from "@/lib/tasks";
import type {
  BranchCell,
  BranchTag,
  BranchTagKind,
  JiraIssue,
  MergeOutcome,
  ProjectGroup,
  ReleaseCheckResult,
  RepoFetchResult,
  Repository,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const cellKey = (repoId: string, ticketKey: string) => `${repoId}::${ticketKey}`;
const tagKey = (repoId: string, branchName: string) => `${repoId}::${branchName}`;

export function ReleasesPage() {
  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: listGroups,
  });

  const [groupId, setGroupId] = useState<string | "">("");
  const [versionName, setVersionName] = useState<string | "">("");
  const [result, setResult] = useState<ReleaseCheckResult | null>(null);
  const [mergeOutcomes, setMergeOutcomes] = useState<Map<string, MergeOutcome>>(
    new Map(),
  );
  const [branchTags, setBranchTagsMap] = useState<Map<string, BranchTag>>(
    new Map(),
  );

  const setOutcome = (key: string, outcome: MergeOutcome) =>
    setMergeOutcomes((prev) => {
      const next = new Map(prev);
      next.set(key, outcome);
      return next;
    });

  const group = useMemo(
    () => groups.find((g) => g.id === groupId) ?? null,
    [groups, groupId],
  );

  const { data: reposForGroup = [] } = useQuery({
    queryKey: ["repos", groupId],
    queryFn: () => listRepositories(groupId),
    enabled: Boolean(groupId),
  });

  useEffect(() => {
    if (!groupId) {
      void clearWatchedRepos();
      return;
    }
    void watchGroupRepos(groupId);
    return () => {
      void clearWatchedRepos();
    };
  }, [groupId]);

  const rechcheckRepo = useCallback(
    async (repoId: string, ticketKeys: string[]) => {
      if (!groupId || ticketKeys.length === 0) return;
      const repoName =
        reposForGroup.find((r) => r.id === repoId)?.name ?? "repo";
      try {
        const fresh = await runTask({
          kind: "recheck",
          title:
            ticketKeys.length === 1
              ? `Recheck ${ticketKeys[0]} · ${repoName}`
              : `Recheck ${ticketKeys.length} cells · ${repoName}`,
          command: () => recheckRepoCells(groupId, repoId, ticketKeys),
        });
        setResult((prev) =>
          prev
            ? {
                ...prev,
                cells: prev.cells.map((c) => {
                  if (c.repoId !== repoId) return c;
                  const updated = fresh.find(
                    (f) => f.ticketKey === c.ticketKey,
                  );
                  return updated ?? c;
                }),
              }
            : null,
        );
        setMergeOutcomes((prev) => {
          const next = new Map(prev);
          for (const f of fresh) {
            if (!f.mergeInProgress) {
              next.delete(cellKey(repoId, f.ticketKey));
            }
          }
          return next;
        });
      } catch {
        // Failures show up in the activity bar; no toast spam.
      }
    },
    [groupId, reposForGroup],
  );

  useRepoChanged(
    useCallback(
      (repoId: string) => {
        if (!result) return;
        const keys = result.cells
          .filter((c) => c.repoId === repoId)
          .map((c) => c.ticketKey);
        if (keys.length > 0) void rechcheckRepo(repoId, keys);
      },
      [result, rechcheckRepo],
    ),
  );

  const handleTagChange = useCallback(
    async (repoId: string, branchName: string, kind: BranchTagKind | null) => {
      try {
        const updated = await setBranchTag(repoId, branchName, kind);
        setBranchTagsMap((prev) => {
          const next = new Map(prev);
          const key = tagKey(repoId, branchName);
          if (updated) next.set(key, updated);
          else next.delete(key);
          return next;
        });
      } catch (e) {
        toast.error(`Failed to set tag: ${e}`);
      }
    },
    [],
  );

  if (groups.length === 0) {
    return (
      <PageWrapper>
        <Header />
        <Alert>
          <AlertTitle>No project groups yet</AlertTitle>
          <AlertDescription>
            Head to <strong>Settings → Project Groups</strong> to create one,
            then come back here to run a release check.
          </AlertDescription>
        </Alert>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <Header />
      <ContextCard
        groups={groups}
        groupId={groupId}
        onGroupChange={(id) => {
          setGroupId(id);
          setVersionName("");
          setResult(null);
          setMergeOutcomes(new Map());
          setBranchTagsMap(new Map());
        }}
        versionName={versionName}
        onVersionChange={setVersionName}
        onResult={async (r) => {
          setResult(r);
          setMergeOutcomes(new Map());
          if (r) {
            const repoIds = [...new Set(r.cells.map((c) => c.repoId))];
            const allTags = await Promise.all(
              repoIds.map((id) => listBranchTags(id)),
            );
            const map = new Map<string, BranchTag>();
            allTags
              .flat()
              .forEach((t) => map.set(tagKey(t.repoId, t.branchName), t));
            setBranchTagsMap(map);
          }
        }}
        currentResult={result}
      />
      {result && group && (
        <ResultView
          result={result}
          group={group}
          mergeOutcomes={mergeOutcomes}
          branchTags={branchTags}
          setOutcome={setOutcome}
          onRecheck={rechcheckRepo}
          onTagChange={handleTagChange}
        />
      )}
    </PageWrapper>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-4 p-6">{children}</div>;
}

function Header() {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Releases</h1>
      <p className="text-sm text-muted-foreground">
        Pick a project group and a Jira fixVersion, then check merge status.
      </p>
    </header>
  );
}

// ---------- Context (group + version + actions) ----------

function ContextCard({
  groups,
  groupId,
  onGroupChange,
  versionName,
  onVersionChange,
  onResult,
  currentResult,
}: {
  groups: ProjectGroup[];
  groupId: string;
  onGroupChange: (id: string) => void;
  versionName: string;
  onVersionChange: (v: string) => void;
  onResult: (r: ReleaseCheckResult | null) => Promise<void>;
  currentResult: ReleaseCheckResult | null;
}) {
  const qc = useQueryClient();
  const group = groups.find((g) => g.id === groupId) ?? null;

  const versions = useQuery({
    queryKey: ["jiraVersions", groupId],
    queryFn: () => listJiraVersions(groupId),
    enabled: Boolean(groupId && group?.jiraProjectKey),
  });

  const repos = useQuery({
    queryKey: ["repos", groupId],
    queryFn: () => listRepositories(groupId),
    enabled: Boolean(groupId),
  });

  const [fetchResult, setFetchResult] = useState<RepoFetchResult[] | null>(
    null,
  );

  const fetchAll = useMutation({
    mutationFn: () =>
      runTask({
        kind: "fetch-repos",
        title: `Fetch repos · ${group?.name ?? "—"}`,
        command: (taskId) => fetchRepos(groupId, taskId),
      }),
    onSuccess: (results) => {
      setFetchResult(results);
      const ok = results.filter((r) => r.success).length;
      const failed = results.length - ok;
      if (failed === 0) {
        toast.success(`Fetched ${ok} repo${ok === 1 ? "" : "s"}`);
      }
      qc.invalidateQueries({ queryKey: ["jiraVersions", groupId] });
    },
    onError: (e) => {
      setFetchResult(null);
      toast.error(`Fetch failed: ${e}`);
    },
  });

  const check = useMutation({
    mutationFn: () =>
      runTask({
        kind: "check-release",
        title: `Check ${versionName} · ${group?.name ?? "—"}`,
        command: (taskId) => checkRelease(groupId, versionName, taskId),
      }),
    onSuccess: async (r) => {
      await onResult(r);
      toast.success(`Checked ${r.tickets.length} tickets`);
    },
    onError: (e) => toast.error(`Check failed: ${e}`),
  });

  return (
    <Card className="sticky top-0 z-10 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Context</CardTitle>
        <CardDescription>
          {group?.jiraProjectKey
            ? `Jira project: ${group.jiraProjectKey}`
            : "Pick a group with a Jira project key to load fixVersions."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <LabelledSelect
            label="Project group"
            value={groupId}
            onChange={onGroupChange}
            placeholder="Select a group…"
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
          <LabelledSelect
            label="Jira fixVersion"
            value={versionName}
            onChange={onVersionChange}
            placeholder={
              !groupId
                ? "Select a group first"
                : !group?.jiraProjectKey
                  ? "Group has no Jira key"
                  : versions.isLoading
                    ? "Loading versions…"
                    : versions.isError
                      ? "Failed to load (see error below)"
                      : "Select a version…"
            }
            disabled={
              !groupId ||
              !group?.jiraProjectKey ||
              versions.isLoading ||
              versions.isError
            }
            options={(versions.data ?? [])
              .filter((v) => !v.archived)
              .map((v) => ({
                value: v.name,
                label: v.released ? `${v.name} (released)` : v.name,
              }))}
          />
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!groupId || fetchAll.isPending}
              onClick={() => fetchAll.mutate()}
            >
              {fetchAll.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Fetch repos
            </Button>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full md:w-auto"
              disabled={!groupId || !versionName || check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Check status
            </Button>
          </div>
        </div>
        {versions.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Couldn't load Jira versions</AlertTitle>
            <AlertDescription>{String(versions.error)}</AlertDescription>
          </Alert>
        )}
        {fetchResult && (
          <FetchResultPanel
            results={fetchResult}
            repos={repos.data ?? []}
            onDismiss={() => setFetchResult(null)}
          />
        )}
        {currentResult && currentResult.versionName !== versionName && (
          <p className="text-xs text-muted-foreground">
            Showing results for{" "}
            <code className="font-mono">{currentResult.versionName}</code> —
            click <strong>Check status</strong> to refresh for{" "}
            <code className="font-mono">{versionName}</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FetchResultPanel({
  results,
  repos,
  onDismiss,
}: {
  results: RepoFetchResult[];
  repos: Repository[];
  onDismiss: () => void;
}) {
  const failures = results.filter((r) => !r.success);
  const successCount = results.length - failures.length;
  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? id;

  if (failures.length === 0) {
    return (
      <Alert>
        <AlertTitle>Fetched all {successCount} repositories</AlertTitle>
        <AlertDescription>
          <button
            onClick={onDismiss}
            className="text-xs underline-offset-2 hover:underline"
          >
            dismiss
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>
        {successCount} succeeded, {failures.length} failed
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-1">
          {failures.map((f) => (
            <li key={f.repoId} className="text-sm">
              <span className="font-medium">{repoName(f.repoId)}</span>
              {f.error && (
                <>
                  {": "}
                  <span className="text-xs">{f.error}</span>
                </>
              )}
            </li>
          ))}
        </ul>
        <button
          onClick={onDismiss}
          className="mt-2 text-xs underline-offset-2 hover:underline"
        >
          dismiss
        </button>
      </AlertDescription>
    </Alert>
  );
}

function LabelledSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------- Result view (per-repo accordions) ----------

function ResultView({
  result,
  group,
  mergeOutcomes,
  branchTags,
  setOutcome,
  onRecheck,
  onTagChange,
}: {
  result: ReleaseCheckResult;
  group: ProjectGroup;
  mergeOutcomes: Map<string, MergeOutcome>;
  branchTags: Map<string, BranchTag>;
  setOutcome: (key: string, outcome: MergeOutcome) => void;
  onRecheck: (repoId: string, ticketKeys: string[]) => void;
  onTagChange: (
    repoId: string,
    branchName: string,
    kind: BranchTagKind | null,
  ) => Promise<void>;
}) {
  const { data: repos = [] } = useQuery({
    queryKey: ["repos", group.id],
    queryFn: () => listRepositories(group.id),
  });

  const cellsByRepo = useMemo(() => {
    const m = new Map<string, BranchCell[]>();
    for (const c of result.cells) {
      const arr = m.get(c.repoId) ?? [];
      arr.push(c);
      m.set(c.repoId, arr);
    }
    return m;
  }, [result.cells]);

  const [open, setOpen] = useState<string[]>(() =>
    repos.length > 0 ? [repos[0].id] : [],
  );

  const totals = useMemo(
    () => summarize(result.cells, mergeOutcomes, branchTags),
    [result.cells, mergeOutcomes, branchTags],
  );

  if (result.tickets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{result.versionName}</CardTitle>
          <CardDescription>
            checked {new Date(result.checkedAt).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No issues found for fixVersion{" "}
            <code className="font-mono">{result.versionName}</code> in Jira
            project <code className="font-mono">{group.jiraProjectKey}</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const ticketsByKey = new Map(result.tickets.map((t) => [t.key, t]));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>{result.versionName}</CardTitle>
          <CardDescription>
            {result.tickets.length} ticket
            {result.tickets.length === 1 ? "" : "s"} across {repos.length}{" "}
            repo{repos.length === 1 ? "" : "s"} • checked{" "}
            {new Date(result.checkedAt).toLocaleString()}
          </CardDescription>
        </div>
        <SummaryBadges totals={totals} />
      </CardHeader>
      <CardContent>
        <Accordion
          type="multiple"
          value={open}
          onValueChange={setOpen}
          className="w-full"
        >
          {repos.map((repo) => {
            const cells = cellsByRepo.get(repo.id) ?? [];
            return (
              <RepoAccordionItem
                key={repo.id}
                repo={repo}
                cells={cells}
                ticketsByKey={ticketsByKey}
                mergeOutcomes={mergeOutcomes}
                branchTags={branchTags}
                setOutcome={setOutcome}
                onRecheck={onRecheck}
                onTagChange={onTagChange}
              />
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function RepoAccordionItem({
  repo,
  cells,
  ticketsByKey,
  mergeOutcomes,
  branchTags,
  setOutcome,
  onRecheck,
  onTagChange,
}: {
  repo: Repository;
  cells: BranchCell[];
  ticketsByKey: Map<string, JiraIssue>;
  mergeOutcomes: Map<string, MergeOutcome>;
  branchTags: Map<string, BranchTag>;
  setOutcome: (key: string, outcome: MergeOutcome) => void;
  onRecheck: (repoId: string, ticketKeys: string[]) => void;
  onTagChange: (
    repoId: string,
    branchName: string,
    kind: BranchTagKind | null,
  ) => Promise<void>;
}) {
  const repoTotals = summarize(cells, mergeOutcomes, branchTags);
  const mergeableCells = useMemo(
    () =>
      cells.filter((c) => {
        const tag = c.resolvedBranch
          ? branchTags.get(tagKey(c.repoId, c.resolvedBranch))
          : undefined;
        return isMergeableNow(
          c,
          mergeOutcomes.get(cellKey(c.repoId, c.ticketKey)),
          tag,
        );
      }),
    [cells, mergeOutcomes, branchTags],
  );
  const [bulkRunning, setBulkRunning] = useState(false);

  const runBulkMerge = async () => {
    if (mergeableCells.length === 0) return;
    setBulkRunning(true);
    try {
      let mergedCount = 0;
      await runBatchTask<BranchCell, MergeOutcome | null>({
        kind: "bulk-merge",
        title: `Bulk merge · ${repo.name}`,
        items: mergeableCells,
        perItem: async (c) => {
          if (!c.resolvedBranch) {
            return {
              result: null,
              log: {
                level: "error",
                message: `${c.ticketKey}: no resolved branch — skipped`,
              },
              continueAfter: true,
            };
          }
          try {
            const outcome = await mergeBranch(repo.id, c.resolvedBranch);
            setOutcome(cellKey(c.repoId, c.ticketKey), outcome);
            if (outcome.kind === "success") {
              mergedCount++;
              return {
                result: outcome,
                log: { level: "success", message: `${c.ticketKey}: merged` },
              };
            }
            return {
              result: outcome,
              log: {
                level: "error",
                message: `${c.ticketKey}: ${outcome.kind} — stopped bulk merge`,
              },
              continueAfter: false,
            };
          } catch (e) {
            return {
              result: null,
              log: { level: "error", message: `${c.ticketKey}: ${e}` },
              continueAfter: false,
            };
          }
        },
      });
      if (mergedCount === mergeableCells.length) {
        toast.success(`${repo.name}: merged ${mergedCount} ticket(s)`);
      } else {
        toast.error(
          `${repo.name}: merged ${mergedCount}/${mergeableCells.length} — see activity bar`,
        );
      }
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <AccordionItem value={repo.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex w-full items-center justify-between gap-4 pr-2">
          <div className="flex flex-col items-start">
            <span className="font-medium">{repo.name}</span>
            <span className="text-xs text-muted-foreground">{repo.path}</span>
          </div>
          <SummaryChips totals={repoTotals} />
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3">
          {mergeableCells.length > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={bulkRunning}
                onClick={runBulkMerge}
              >
                {bulkRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GitMerge className="size-4" />
                )}
                Merge {mergeableCells.length} pending
              </Button>
            </div>
          )}
          <RepoTicketList
            repo={repo}
            cells={cells}
            ticketsByKey={ticketsByKey}
            mergeOutcomes={mergeOutcomes}
            branchTags={branchTags}
            setOutcome={setOutcome}
            onRecheck={onRecheck}
            onTagChange={onTagChange}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function RepoTicketList({
  repo,
  cells,
  ticketsByKey,
  mergeOutcomes,
  branchTags,
  setOutcome,
  onRecheck,
  onTagChange,
}: {
  repo: Repository;
  cells: BranchCell[];
  ticketsByKey: Map<string, JiraIssue>;
  mergeOutcomes: Map<string, MergeOutcome>;
  branchTags: Map<string, BranchTag>;
  setOutcome: (key: string, outcome: MergeOutcome) => void;
  onRecheck: (repoId: string, ticketKeys: string[]) => void;
  onTagChange: (
    repoId: string,
    branchName: string,
    kind: BranchTagKind | null,
  ) => Promise<void>;
}) {
  if (cells.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        No data for this repository.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {cells.map((c) => (
        <TicketRow
          key={c.ticketKey}
          repo={repo}
          cell={c}
          ticket={ticketsByKey.get(c.ticketKey)}
          outcome={mergeOutcomes.get(cellKey(c.repoId, c.ticketKey))}
          tag={
            c.resolvedBranch
              ? branchTags.get(tagKey(c.repoId, c.resolvedBranch))
              : undefined
          }
          setOutcome={(o) => setOutcome(cellKey(c.repoId, c.ticketKey), o)}
          onRecheck={() => onRecheck(c.repoId, [c.ticketKey])}
          onTagChange={(kind) => {
            if (c.resolvedBranch) {
              void onTagChange(c.repoId, c.resolvedBranch, kind);
            }
          }}
        />
      ))}
    </ul>
  );
}

// ---------- single ticket row ----------

function TicketRow({
  repo,
  cell,
  ticket,
  outcome,
  tag,
  setOutcome,
  onRecheck,
  onTagChange,
}: {
  repo: Repository;
  cell: BranchCell;
  ticket: JiraIssue | undefined;
  outcome: MergeOutcome | undefined;
  tag: BranchTag | undefined;
  setOutcome: (o: MergeOutcome) => void;
  onRecheck: () => void;
  onTagChange: (kind: BranchTagKind | null) => void;
}) {
  const merge = useMutation({
    mutationFn: () =>
      runTask({
        kind: "merge",
        title: `Merge ${cell.ticketKey} · ${repo.name}`,
        command: () => mergeBranch(repo.id, cell.resolvedBranch!),
      }),
    onSuccess: (o) => {
      setOutcome(o);
      if (o.kind === "success") toast.success(`${cell.ticketKey} merged`);
      else if (o.kind === "conflict")
        toast.error(`${cell.ticketKey}: conflict — resolve externally`);
      else if (o.kind === "dirty-working-tree")
        toast.error(`${cell.ticketKey}: working tree not clean`);
      else toast.error(`${cell.ticketKey}: ${o.message.slice(0, 80)}`);
    },
    onError: (e) => toast.error(`Merge failed: ${e}`),
  });

  const canMerge = isMergeableNow(cell, outcome, tag);

  return (
    <li className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 px-3 py-2">
      <div className="font-mono text-sm font-medium">{cell.ticketKey}</div>
      <div className="min-w-0">
        <div className="truncate text-sm">{ticket?.summary ?? "—"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {cell.resolvedBranch ? (
            <>
              <span className="font-mono">{cell.resolvedBranch}</span>
              {cell.commitsBehind != null &&
                cell.verdict !== "merged" &&
                ` · ${cell.commitsBehind} behind`}
            </>
          ) : cell.note ? (
            cell.note
          ) : (
            "no branch resolved"
          )}
        </div>
        {tag && (
          <div className="mt-0.5">
            <BranchTagBadge kind={tag.kind} />
          </div>
        )}
        {outcome && outcome.kind !== "success" && (
          <p className="mt-1 text-xs text-destructive">
            {truncate(outcome.message, 220)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <DisplayVerdict cell={cell} outcome={outcome} />
        {cell.resolvedBranch && (
          <BranchTagPicker tag={tag} onTagChange={onTagChange} />
        )}
        {canMerge && (
          <Button
            size="sm"
            variant="outline"
            disabled={merge.isPending || !cell.resolvedBranch}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <GitMerge className="size-3" />
            )}
            Merge
          </Button>
        )}
        {outcome?.kind === "conflict" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openInMergeTool(repo.id).catch((e) => toast.error(String(e)))
              }
            >
              <ExternalLink className="size-3" />
              Open in merge tool
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                openInExplorer(repo.id).catch((e) => toast.error(String(e)))
              }
              title="Open repo folder in Explorer"
            >
              <FolderOpen className="size-3" />
            </Button>
          </>
        )}
        {outcome && outcome.kind !== "success" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRecheck}
            title="Re-check this cell's git state"
          >
            <RotateCw className="size-3" />
            Recheck
          </Button>
        )}
      </div>
    </li>
  );
}

function isMergeableNow(
  cell: BranchCell,
  outcome: MergeOutcome | undefined,
  tag: BranchTag | undefined,
): boolean {
  if (cell.verdict !== "not-merged") return false;
  if (outcome?.kind === "success") return false;
  if (!cell.resolvedBranch) return false;
  // Tagged branches are excluded from merge
  if (tag) return false;
  return true;
}

// ---------- summary helpers ----------

type Totals = {
  merged: number;
  notMerged: number;
  notFound: number;
  problems: number;
  skipped: number;
};

function summarize(
  cells: BranchCell[],
  outcomes: Map<string, MergeOutcome>,
  branchTags: Map<string, BranchTag>,
): Totals {
  const t: Totals = {
    merged: 0,
    notMerged: 0,
    notFound: 0,
    problems: 0,
    skipped: 0,
  };
  for (const c of cells) {
    const o = outcomes.get(cellKey(c.repoId, c.ticketKey));
    if (o?.kind === "success") {
      t.merged++;
      continue;
    }
    if (o) {
      t.problems++;
      continue;
    }
    const tag = c.resolvedBranch
      ? branchTags.get(tagKey(c.repoId, c.resolvedBranch))
      : undefined;
    if (tag && c.verdict === "not-merged") {
      t.skipped++;
      continue;
    }
    switch (c.verdict) {
      case "merged":
        t.merged++;
        break;
      case "not-merged":
        t.notMerged++;
        break;
      case "not-found":
        t.notFound++;
        break;
      case "target-missing":
      case "error":
        t.problems++;
        break;
    }
  }
  return t;
}

function SummaryBadges({ totals }: { totals: Totals }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Badge
        variant="outline"
        className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
      >
        {totals.merged} merged
      </Badge>
      <Badge
        variant="outline"
        className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
      >
        {totals.notMerged} pending
      </Badge>
      <Badge variant="outline" className="text-muted-foreground">
        {totals.notFound} not found
      </Badge>
      {totals.skipped > 0 && (
        <Badge
          variant="outline"
          className="border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
        >
          {totals.skipped} skipped
        </Badge>
      )}
      {totals.problems > 0 && (
        <Badge variant="destructive">{totals.problems} problems</Badge>
      )}
    </div>
  );
}

function SummaryChips({ totals }: { totals: Totals }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {totals.merged > 0 && (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {totals.merged}✓
        </span>
      )}
      {totals.notMerged > 0 && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {totals.notMerged} pending
        </span>
      )}
      {totals.notFound > 0 && (
        <span className="rounded bg-muted px-1.5 py-0.5">
          {totals.notFound} not found
        </span>
      )}
      {totals.skipped > 0 && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {totals.skipped} skipped
        </span>
      )}
      {totals.problems > 0 && (
        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
          {totals.problems} problems
        </span>
      )}
    </div>
  );
}

// ---------- verdict badge (respects post-merge overrides) ----------

function DisplayVerdict({
  cell,
  outcome,
}: {
  cell: BranchCell;
  outcome: MergeOutcome | undefined;
}) {
  if (outcome) {
    switch (outcome.kind) {
      case "success":
        return (
          <Badge
            variant="outline"
            className={cn(
              "gap-1 border-emerald-300 bg-emerald-50 text-emerald-800",
              "dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
            )}
          >
            <Check className="size-3" />
            merged
          </Badge>
        );
      case "conflict":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" />
            conflict
          </Badge>
        );
      case "dirty-working-tree":
        return (
          <Badge
            variant="outline"
            className="gap-1 border-orange-300 text-orange-800 dark:border-orange-800 dark:text-orange-200"
          >
            dirty tree
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" />
            failed
          </Badge>
        );
    }
  }
  return <VerdictBadge cell={cell} />;
}

function VerdictBadge({ cell }: { cell: BranchCell }) {
  switch (cell.verdict) {
    case "merged":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-emerald-300 bg-emerald-50 text-emerald-800",
            "dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
          )}
        >
          <Check className="size-3" />
          merged
        </Badge>
      );
    case "not-merged":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-amber-300 bg-amber-50 text-amber-800",
            "dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
          )}
        >
          {cell.commitsBehind != null
            ? `${cell.commitsBehind} behind`
            : "not merged"}
        </Badge>
      );
    case "not-found":
      return (
        <span className="text-muted-foreground">
          <Minus className="size-4 inline" />
        </span>
      );
    case "target-missing":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-orange-300 text-orange-800 dark:border-orange-800 dark:text-orange-200"
        >
          <CircleHelp className="size-3" />
          no target
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="size-3" />
          error
        </Badge>
      );
  }
}

// ---------- branch tag sub-components ----------

const TAG_META: Record<BranchTagKind, { label: string; className: string }> = {
  broken: {
    label: "broken",
    className:
      "border-red-300 text-red-700 dark:border-red-700 dark:text-red-300",
  },
  "not-needed": {
    label: "not needed",
    className:
      "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300",
  },
  obsolete: {
    label: "obsolete",
    className:
      "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-300",
  },
  wip: {
    label: "WIP",
    className:
      "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300",
  },
};

function BranchTagBadge({ kind }: { kind: BranchTagKind }) {
  const meta = TAG_META[kind];
  return (
    <Badge variant="outline" className={cn("text-xs", meta.className)}>
      {meta.label}
    </Badge>
  );
}

function BranchTagPicker({
  tag,
  onTagChange,
}: {
  tag: BranchTag | undefined;
  onTagChange: (kind: BranchTagKind | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={tag ? "secondary" : "ghost"}
          className="h-7 px-2"
          title={
            tag
              ? `Tagged: ${TAG_META[tag.kind].label} — click to change`
              : "Tag this branch"
          }
        >
          <Tag className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(["broken", "not-needed", "obsolete", "wip"] as BranchTagKind[]).map(
          (k) => (
            <DropdownMenuItem
              key={k}
              onClick={() => onTagChange(k)}
              className={cn(tag?.kind === k && "font-medium")}
            >
              {tag?.kind === k && <Check className="mr-2 size-3" />}
              {TAG_META[k].label}
            </DropdownMenuItem>
          ),
        )}
        {tag && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onTagChange(null)}
              className="text-muted-foreground"
            >
              Clear tag
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
