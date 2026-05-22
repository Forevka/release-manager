import { useState } from "react";
import { AppShell, type NavSection } from "@/components/AppShell";
import { ChangelogPage } from "@/features/changelog/ChangelogPage";
import { ReleasesPage } from "@/features/releases/ReleasesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

function App() {
  const [active, setActive] = useState<NavSection>("releases");

  return (
    <AppShell active={active} onChange={setActive}>
      {active === "releases" && <ReleasesPage />}
      {active === "changelog" && <ChangelogPage />}
      {active === "settings" && <SettingsPage />}
    </AppShell>
  );
}

export default App;
