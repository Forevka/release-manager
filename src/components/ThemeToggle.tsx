import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-state toggle: light ↔ dark. Initial value comes from the system
 * preference (via next-themes' `defaultTheme="system"` in main.tsx); the
 * first click moves the user to an explicit mode and stays there.
 *
 * Renders nothing until mounted to avoid a hydration flash where the
 * server-side `theme` is undefined.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const baseClass = cn(
    "inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground transition-colors",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    className,
  );

  if (!mounted) {
    // Placeholder keeps layout stable until theme resolves.
    return <span className={baseClass} aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={baseClass}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
