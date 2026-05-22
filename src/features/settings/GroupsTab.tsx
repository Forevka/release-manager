import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight,
  FolderOpen,
  Globe,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { DiscoverFromGitLabDialog } from "./DiscoverFromGitLabDialog";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  createGroup,
  createRepository,
  deleteGroup,
  deleteRepository,
  listGroups,
  listRepositories,
  pickDirectory,
  updateGroup,
  updateRepository,
} from "@/lib/api";
import type {
  NewProjectGroup,
  NewRepository,
  ProjectGroup,
  Repository,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_GROUP: NewProjectGroup = {
  name: "",
  jiraProjectKey: null,
  defaultReleaseBranch: "UAT",
  defaultProdBranch: "main",
  gitTimeoutSeconds: 60,
  maxRetries: 3,
};

// ---------- top-level component ----------

export function GroupsTab() {
  const qc = useQueryClient();
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: listGroups,
  });
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; group: ProjectGroup } | null
  >(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: deleteGroup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.message("Group deleted");
    },
    onError: (e) => toast.error(`Delete failed: ${e}`),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Project Groups</CardTitle>
          <CardDescription>
            Each group bundles repos that release together. Click a row to
            view its repositories.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDiscoverOpen(true)}>
            <Globe className="size-4" />
            Discover from GitLab
          </Button>
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus className="size-4" />
            Add Group
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No groups yet. Click <strong>Add Group</strong> to create one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Jira Key</TableHead>
                <TableHead>Release branch</TableHead>
                <TableHead>Prod branch</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <>
                  <TableRow
                    key={g.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpanded((prev) => (prev === g.id ? null : g.id))
                    }
                  >
                    <TableCell>
                      <ChevronRight
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          expanded === g.id && "rotate-90",
                        )}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell>
                      {g.jiraProjectKey ? (
                        <Badge variant="secondary">{g.jiraProjectKey}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{g.defaultReleaseBranch}</code>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{g.defaultProdBranch}</code>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDialog({ mode: "edit", group: g })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete group "${g.name}" and all its repositories from the app config? Local git clones are not touched.`,
                            )
                          ) {
                            remove.mutate(g.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded === g.id && (
                    <TableRow key={`${g.id}-repos`}>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <RepoSubTable group={g} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {dialog && (
        <GroupDialog
          mode={dialog.mode}
          group={dialog.mode === "edit" ? dialog.group : null}
          onClose={() => setDialog(null)}
        />
      )}
      {discoverOpen && (
        <DiscoverFromGitLabDialog onClose={() => setDiscoverOpen(false)} />
      )}
    </Card>
  );
}

// ---------- group create/edit dialog ----------

function GroupDialog({
  mode,
  group,
  onClose,
}: {
  mode: "create" | "edit";
  group: ProjectGroup | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<NewProjectGroup>(
    group
      ? {
          name: group.name,
          jiraProjectKey: group.jiraProjectKey,
          defaultReleaseBranch: group.defaultReleaseBranch,
          defaultProdBranch: group.defaultProdBranch,
          gitTimeoutSeconds: group.gitTimeoutSeconds,
          maxRetries: group.maxRetries,
        }
      : EMPTY_GROUP,
  );

  const save = useMutation({
    mutationFn: () =>
      mode === "create"
        ? createGroup(form)
        : updateGroup(group!.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success(mode === "create" ? "Group created" : "Group updated");
      onClose();
    },
    onError: (e) => toast.error(`Save failed: ${e}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add Project Group" : "Edit Project Group"}
          </DialogTitle>
          <DialogDescription>
            Names must be unique within the app. Branch defaults are inherited
            by all repositories in the group unless overridden per-repo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field id="grp-name" label="Name">
            <Input
              id="grp-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field
            id="grp-jira"
            label="Jira Project Key"
            hint="Optional. Used to query fixVersions and issues."
          >
            <Input
              id="grp-jira"
              placeholder="e.g. KEYS"
              value={form.jiraProjectKey ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  jiraProjectKey: e.target.value || null,
                })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="grp-release" label="Default release branch">
              <Input
                id="grp-release"
                value={form.defaultReleaseBranch}
                onChange={(e) =>
                  setForm({ ...form, defaultReleaseBranch: e.target.value })
                }
              />
            </Field>
            <Field id="grp-prod" label="Default prod branch">
              <Input
                id="grp-prod"
                value={form.defaultProdBranch}
                onChange={(e) =>
                  setForm({ ...form, defaultProdBranch: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field id="grp-timeout" label="Git timeout (s)">
              <Input
                id="grp-timeout"
                type="number"
                min={1}
                value={form.gitTimeoutSeconds}
                onChange={(e) =>
                  setForm({
                    ...form,
                    gitTimeoutSeconds: Number(e.target.value) || 60,
                  })
                }
              />
            </Field>
            <Field id="grp-retries" label="Max retries">
              <Input
                id="grp-retries"
                type="number"
                min={0}
                value={form.maxRetries}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maxRetries: Number(e.target.value) || 0,
                  })
                }
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.name.trim() || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- repos table inside an expanded group row ----------

function RepoSubTable({ group }: { group: ProjectGroup }) {
  const qc = useQueryClient();
  const { data: repos = [], isLoading } = useQuery({
    queryKey: ["repos", group.id],
    queryFn: () => listRepositories(group.id),
  });
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; repo: Repository } | null
  >(null);

  const remove = useMutation({
    mutationFn: deleteRepository,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repos", group.id] });
      toast.message("Repository removed");
    },
    onError: (e) => toast.error(`Delete failed: ${e}`),
  });

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Repositories</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus className="size-4" />
          Add Repo
        </Button>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">loading…</p>
      ) : repos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No repositories in this group yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Local path</TableHead>
              <TableHead>Release</TableHead>
              <TableHead>Prod</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repos.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>
                  <code className="text-xs">{r.path}</code>
                </TableCell>
                <TableCell>
                  <BranchCell
                    value={r.releaseBranch}
                    fallback={group.defaultReleaseBranch}
                  />
                </TableCell>
                <TableCell>
                  <BranchCell
                    value={r.prodBranch}
                    fallback={group.defaultProdBranch}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialog({ mode: "edit", repo: r })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          `Remove "${r.name}" from this group? The local clone is not touched.`,
                        )
                      ) {
                        remove.mutate(r.id);
                      }
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialog && (
        <RepoDialog
          mode={dialog.mode}
          group={group}
          repo={dialog.mode === "edit" ? dialog.repo : null}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function BranchCell({
  value,
  fallback,
}: {
  value: string | null;
  fallback: string;
}) {
  if (value) {
    return <code className="text-xs">{value}</code>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      <code>{fallback}</code> (inherited)
    </span>
  );
}

// ---------- repo create/edit dialog ----------

function RepoDialog({
  mode,
  group,
  repo,
  onClose,
}: {
  mode: "create" | "edit";
  group: ProjectGroup;
  repo: Repository | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<NewRepository>(
    repo
      ? {
          groupId: group.id,
          name: repo.name,
          path: repo.path,
          releaseBranch: repo.releaseBranch,
          prodBranch: repo.prodBranch,
        }
      : {
          groupId: group.id,
          name: "",
          path: "",
          releaseBranch: null,
          prodBranch: null,
        },
  );

  const save = useMutation({
    mutationFn: () =>
      mode === "create"
        ? createRepository(form)
        : updateRepository(repo!.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repos", group.id] });
      toast.success(mode === "create" ? "Repository added" : "Repository updated");
      onClose();
    },
    onError: (e) => toast.error(`Save failed: ${e}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? `Add Repository to ${group.name}`
              : `Edit Repository`}
          </DialogTitle>
          <DialogDescription>
            Branch fields are optional. If empty, the group's defaults are
            used (<code>{group.defaultReleaseBranch}</code> /{" "}
            <code>{group.defaultProdBranch}</code>).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field id="repo-name" label="Name">
            <Input
              id="repo-name"
              placeholder="e.g. backend-api"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field id="repo-path" label="Local path">
            <div className="flex gap-2">
              <Input
                id="repo-path"
                placeholder="C:\\repos\\backend-api"
                value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const picked = await pickDirectory(
                    "Select the repository folder",
                  );
                  if (picked) setForm({ ...form, path: picked });
                }}
              >
                <FolderOpen className="size-4" />
                Browse
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              id="repo-release"
              label="Release branch override"
              hint="Leave blank to inherit"
            >
              <Input
                id="repo-release"
                placeholder={group.defaultReleaseBranch}
                value={form.releaseBranch ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    releaseBranch: e.target.value || null,
                  })
                }
              />
            </Field>
            <Field
              id="repo-prod"
              label="Prod branch override"
              hint="Leave blank to inherit"
            >
              <Input
                id="repo-prod"
                placeholder={group.defaultProdBranch}
                value={form.prodBranch ?? ""}
                onChange={(e) =>
                  setForm({ ...form, prodBranch: e.target.value || null })
                }
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              !form.name.trim() || !form.path.trim() || save.isPending
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
