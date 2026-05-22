import { GitPullRequest } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ReleasesPlaceholder() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Releases</h1>
        <p className="text-sm text-muted-foreground">
          Pick a project group and a Jira release to see merge status across
          repositories.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitPullRequest className="size-5 text-muted-foreground" />
            <CardTitle>Coming in phase 3</CardTitle>
          </div>
          <CardDescription>
            The release check matrix lands once at least one project group is
            configured. Head to <strong>Settings → Project Groups</strong> to
            set one up.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Phase 2 ships configuration (connections + groups/repos). Phase 3
          adds the Jira-driven release check that will live here.
        </CardContent>
      </Card>
    </div>
  );
}
