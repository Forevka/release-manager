import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getExternalMergeTool,
  getGitLabConnection,
  getJiraConnection,
  saveExternalMergeTool,
  saveGitLabConnection,
  saveJiraConnection,
} from "@/lib/api";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";

export function ConnectionsTab() {
  return (
    <div className="grid gap-6">
      <JiraCard />
      <GitLabCard />
      <MergeToolCard />
    </div>
  );
}

function JiraCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["jira"], queryFn: getJiraConnection });
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    if (data) {
      setUrl(data.url);
      setEmail(data.email);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveJiraConnection({
        url,
        email,
        // Only send token if user typed something. Empty input = "keep existing".
        token: token.length > 0 ? token : undefined,
      }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["jira"] });
      toast.success("Jira connection saved");
    },
    onError: (e) => toast.error(`Save failed: ${e}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jira</CardTitle>
        <CardDescription>
          Used to fetch fixVersions and the tickets in each release. The token
          is stored in the Windows Credential Manager, never on disk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field id="jira-url" label="URL">
          <Input
            id="jira-url"
            placeholder="https://yourorg.atlassian.net"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field id="jira-email" label="Email">
          <Input
            id="jira-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          id="jira-token"
          label="API Token"
          hint={
            data?.tokenSet
              ? "A token is currently stored. Leave blank to keep it; type a new value to replace; clear to delete (use the Clear button)."
              : "No token stored yet."
          }
        >
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <Input
              id="jira-token"
              type="password"
              placeholder={data?.tokenSet ? "•••••••• (stored)" : "Paste token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {data?.tokenSet && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                saveJiraConnection({ url, email, token: "" }).then(() => {
                  qc.invalidateQueries({ queryKey: ["jira"] });
                  toast.message("Jira token cleared");
                })
              }
            >
              Clear token
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GitLabCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["gitlab"],
    queryFn: getGitLabConnection,
  });
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    if (data) setUrl(data.url);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveGitLabConnection({
        url,
        token: token.length > 0 ? token : undefined,
      }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["gitlab"] });
      toast.success("GitLab connection saved");
    },
    onError: (e) => toast.error(`Save failed: ${e}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitLab</CardTitle>
        <CardDescription>
          Personal Access Token with at least <code>read_api</code> and{" "}
          <code>read_repository</code> scopes. The token will be used in a
          later phase for group discovery and merge requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field id="gitlab-url" label="URL">
          <Input
            id="gitlab-url"
            placeholder="https://gitlab.devcom.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field
          id="gitlab-token"
          label="API Token"
          hint={
            data?.tokenSet
              ? "A token is currently stored. Leave blank to keep it; type a new value to replace."
              : "No token stored yet."
          }
        >
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <Input
              id="gitlab-token"
              type="password"
              placeholder={data?.tokenSet ? "•••••••• (stored)" : "Paste token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {data?.tokenSet && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                saveGitLabConnection({ url, token: "" }).then(() => {
                  qc.invalidateQueries({ queryKey: ["gitlab"] });
                  toast.message("GitLab token cleared");
                })
              }
            >
              Clear token
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MergeToolCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["externalMergeTool"],
    queryFn: getExternalMergeTool,
  });
  const [path, setPath] = useState("");

  useEffect(() => {
    if (data !== undefined) setPath(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () => saveExternalMergeTool(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["externalMergeTool"] });
      toast.success("Merge tool updated");
    },
    onError: (e) => toast.error(`Save failed: ${e}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>External merge tool</CardTitle>
        <CardDescription>
          Full path to a program launched against a repo when you click{" "}
          <strong>Open in merge tool</strong> on a conflict. The repo's local
          path is passed as the single argument. Leave blank to fall back to
          Windows Explorer on the repo folder.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          id="merge-tool-path"
          label="Executable path"
          hint='Example: C:\Program Files\GitHub Desktop\GitHubDesktop.exe'
        >
          <div className="flex gap-2">
            <Input
              id="merge-tool-path"
              placeholder="(unset — falls back to Explorer)"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const picked = await openDialog({
                  multiple: false,
                  directory: false,
                  title: "Select merge tool executable",
                  filters: [{ name: "Executable", extensions: ["exe"] }],
                });
                if (typeof picked === "string") setPath(picked);
              }}
            >
              <FolderOpen className="size-4" />
              Browse
            </Button>
          </div>
        </Field>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
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
