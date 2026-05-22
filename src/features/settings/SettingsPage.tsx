import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionsTab } from "./ConnectionsTab";
import { GroupsTab } from "./GroupsTab";

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connections to Jira / GitLab and the project groups you release.
        </p>
      </header>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="groups">Project Groups</TabsTrigger>
        </TabsList>
        <TabsContent value="connections" className="mt-6">
          <ConnectionsTab />
        </TabsContent>
        <TabsContent value="groups" className="mt-6">
          <GroupsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
