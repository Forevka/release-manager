import { useState, type ReactNode } from "react";
import { FileText, GitPullRequest, Settings as SettingsIcon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { ActivityBar } from "@/components/Activity";
import { TitleBar } from "@/components/TitleBar";
import { useTaskEventBridge } from "@/lib/task-events";

export type NavSection = "releases" | "changelog" | "settings";

const NAV: { key: NavSection; label: string; icon: typeof SettingsIcon }[] = [
  { key: "releases", label: "Releases", icon: GitPullRequest },
  { key: "changelog", label: "Changelog", icon: FileText },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({
  active,
  onChange,
  children,
}: {
  active: NavSection;
  onChange: (s: NavSection) => void;
  children: ReactNode;
}) {
  useTaskEventBridge();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          <nav className="flex-1 space-y-1 px-3 py-4">
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active === key
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <ActivityBar />
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      <Toaster position="top-right" />
    </div>
  );
}

export function useNavState(initial: NavSection = "releases") {
  const [active, setActive] = useState<NavSection>(initial);
  return { active, setActive };
}
