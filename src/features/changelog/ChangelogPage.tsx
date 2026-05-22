import { useCallback, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  FileText,
  Loader2,
  Play,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateChangelog,
  listGroupTags,
  listGroups,
  listRepositories,
} from "@/lib/api";
import { runTask } from "@/lib/tasks";
import type {
  ChangelogRange,
  ChangelogResult,
  RepoTagOverride,
  Repository,
  TagInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChangelogPage() {
  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: listGroups,
  });

  const [groupId, setGroupId] = useState("");
  const [mode, setMode] = useState<"tags" | "dates">("tags");
  const [fromTag, setFromTag] = useState("");
  const [toTag, setToTag] = useState("");
  const [sinceDate, setSinceDate] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [version, setVersion] = useState("");
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [overrides, setOverrides] = useState<RepoTagOverride[]>([]);
  const [result, setResult] = useState<ChangelogResult | null>(null);

  const tags = useQuery({
    queryKey: ["group-tags", groupId],
    queryFn: () => listGroupTags(groupId),
    enabled: Boolean(groupId),
  });

  const repos = useQuery({
    queryKey: ["repos", groupId],
    queryFn: () => listRepositories(groupId),
    enabled: Boolean(groupId),
  });

  const setOverride = useCallback(
    (repoId: string, tag: string | null | undefined) => {
      setOverrides((prev) => {
        const next = prev.filter((o) => o.repoId !== repoId);
        if (tag !== undefined) next.push({ repoId, tag });
        return next;
      });
    },
    [],
  );

  const range: ChangelogRange =
    mode === "tags"
      ? { kind: "tags", fromTag, toTag }
      : { kind: "dates", since: sinceDate, until: untilDate || null };

  const taskTitle =
    version ||
    (mode === "tags"
      ? `${fromTag}..${toTag}`
      : `${sinceDate} → ${untilDate || "now"}`);

  const generate = useMutation({
    mutationFn: () =>
      runTask({
        kind: "discover",
        title: `Changelog ${taskTitle}`,
        command: () =>
          generateChangelog({
            groupId,
            range,
            version,
            tagOverrides: mode === "tags" ? overrides : [],
          }),
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(
        `Generated: ${r.stats.totalIncluded} commits across ${r.stats.byRepo.length} repos`,
      );
    },
    onError: (e) => toast.error(`Generation failed: ${e}`),
  });

  const canGenerate =
    Boolean(groupId) &&
    !generate.isPending &&
    (mode === "tags"
      ? Boolean(fromTag && toTag && fromTag !== toTag)
      : Boolean(sinceDate));

  const copyToClipboard = useCallback(() => {
    if (!result) return;
    navigator.clipboard
      .writeText(result.markdown)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Failed to copy"));
  }, [result]);

  const saveToFile = useCallback(() => {
    if (!result) return;
    const filename =
      result.version
        ? `Changelog_${result.version}.md`
        : "Changelog.md";
    const blob = new Blob([result.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Saved as ${filename}`);
  }, [result]);

  if (groups.length === 0) {
    return (
      <PageWrapper>
        <Alert>
          <AlertTitle>No project groups yet</AlertTitle>
          <AlertDescription>
            Head to <strong>Settings → Project Groups</strong> to create one
            first.
          </AlertDescription>
        </Alert>
      </PageWrapper>
    );
  }

  return (
    <div className="flex h-full">
      {/* ---- left controls panel ---- */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-sidebar-border bg-sidebar/40 p-4">
        <h2 className="text-sm font-semibold tracking-tight">
          Changelog settings
        </h2>

        <Field label="Project group">
          <Select
            value={groupId}
            onValueChange={(v) => {
              setGroupId(v);
              setFromTag("");
              setToTag("");
              setResult(null);
              setOverrides([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a group…" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {groupId && (
          <>
            {/* mode toggle */}
            <div className="flex overflow-hidden rounded-md border border-input text-xs font-medium">
              {(["tags", "dates"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 py-1.5 transition-colors",
                    m === "dates" && "border-l border-input",
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {m === "tags" ? "By tags" : "By date range"}
                </button>
              ))}
            </div>

            {mode === "tags" ? (
              <>
                <Field label="From tag (baseline)">
                  <TagSelect
                    value={fromTag}
                    onChange={setFromTag}
                    tags={tags.data ?? []}
                    loading={tags.isLoading}
                    placeholder="Select start tag…"
                  />
                </Field>
                <Field label="To tag (target)">
                  <TagSelect
                    value={toTag}
                    onChange={setToTag}
                    tags={tags.data ?? []}
                    loading={tags.isLoading}
                    placeholder="Select end tag or HEAD…"
                    extraOption={{ value: "HEAD", label: "HEAD (current)" }}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Since (from date)" hint="YYYY-MM-DD — commits on or after this date">
                  <input
                    type="date"
                    value={sinceDate}
                    onChange={(e) => setSinceDate(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </Field>
                <Field label="Until (to date)" hint="Leave blank to include up to today">
                  <input
                    type="date"
                    value={untilDate}
                    onChange={(e) => setUntilDate(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </Field>
              </>
            )}

            <Field label="Version / release title" hint="Optional, included in the heading">
              <Input
                placeholder="e.g. 2.0 or Sprint-42"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </Field>

            {/* per-repo tag overrides — tags mode only */}
            {mode === "tags" && (repos.data?.length ?? 0) > 0 && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setOverridesOpen((v) => !v)}
                >
                  {overridesOpen ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  Per-repo tag overrides
                </button>
                {overridesOpen && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Override the "to" tag per repo, or leave blank to use the
                      global selection. Choose "— skip —" to exclude a repo.
                    </p>
                    {(repos.data ?? []).map((repo) => {
                      const found = overrides.find((o) => o.repoId === repo.id);
                      // Represent the three states as a single string so
                      // the Select is always a controlled component:
                      //   ""          → no override (use global to)
                      //   "__skip__"  → exclude this repo
                      //   "<tag>"     → use a specific tag
                      const selectValue =
                        found === undefined ? "__global__" : found.tag === null ? "__skip__" : found.tag;
                      return (
                        <RepoOverrideRow
                          key={repo.id}
                          repo={repo}
                          tags={tags.data ?? []}
                          value={selectValue}
                          onChange={(v) => {
                            if (v === "__global__") setOverride(repo.id, undefined);
                            else if (v === "__skip__") setOverride(repo.id, null);
                            else setOverride(repo.id, v);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <Button
              className="mt-auto w-full"
              disabled={!canGenerate}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Generate
            </Button>
          </>
        )}
      </aside>

      {/* ---- right output panel ---- */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!result ? (
          <EmptyState loading={generate.isPending} />
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-muted-foreground" />
                <span className="font-medium">
                  {result.version
                    ? `Release ${result.version}`
                    : "Changelog"}
                </span>
                <Badge variant="outline" className="text-xs">
                  {result.stats.totalIncluded} commits
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyToClipboard}
                >
                  <ClipboardCopy className="size-3.5" />
                  Copy
                </Button>
                <Button size="sm" variant="outline" onClick={saveToFile}>
                  <Download className="size-3.5" />
                  Save .md
                </Button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed">
              {result.markdown}
            </pre>
          </>
        )}
      </main>
    </div>
  );
}

// ---------- sub-components ----------

function TagSelect({
  value,
  onChange,
  tags,
  loading,
  placeholder,
  extraOption,
}: {
  value: string;
  onChange: (v: string) => void;
  tags: TagInfo[];
  loading: boolean;
  placeholder: string;
  extraOption?: { value: string; label: string };
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={loading}>
      <SelectTrigger>
        <SelectValue
          placeholder={loading ? "Loading tags…" : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        {extraOption && (
          <SelectItem value={extraOption.value}>
            {extraOption.label}
          </SelectItem>
        )}
        {tags.map((t) => (
          <SelectItem key={t.name} value={t.name}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RepoOverrideRow({
  repo,
  tags,
  value,
  onChange,
}: {
  repo: Repository;
  tags: TagInfo[];
  /** Always a controlled string: "" | "__skip__" | tag-name */
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium truncate">{repo.name}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="(use global tag)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__global__">— use global tag —</SelectItem>
          <SelectItem value="__skip__">— skip this repo —</SelectItem>
          {tags.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center text-center">
      <div className="space-y-2 text-muted-foreground">
        {loading ? (
          <>
            <Loader2 className="mx-auto size-8 animate-spin opacity-40" />
            <p className="text-sm">Collecting commits…</p>
          </>
        ) : (
          <>
            <FileText className="mx-auto size-8 opacity-30" />
            <p className="text-sm">
              Select a group, two tags, and click Generate.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return <div className="p-6">{children}</div>;
}
