import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

/**
 * Custom window chrome. The native Windows title bar is hidden via
 * `decorations: false` in tauri.conf.json so we render this strip in its
 * place. The whole bar is `data-tauri-drag-region` (drag-to-move +
 * double-click-to-maximize), with the three Windows-style buttons as
 * non-drag children so their clicks reach our handlers.
 */
export function TitleBar() {
  const isMaximized = useIsMaximized();
  const w = getCurrentWindow();

  const onMinimize = () => void w.minimize();
  const onToggleMax = () => void w.toggleMaximize();
  const onClose = () => void w.close();

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 select-none items-stretch border-b border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div
        data-tauri-drag-region
        className="flex items-center px-3 text-xs font-medium"
      >
        Release Manager
      </div>
      <div data-tauri-drag-region className="flex-1" />
      <div className="flex items-stretch">
        <div className="flex items-center pr-1">
          <ThemeToggle />
        </div>
        <ChromeButton
          onClick={onMinimize}
          title="Minimize"
          hoverClass="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Minus className="size-3.5" />
        </ChromeButton>
        <ChromeButton
          onClick={onToggleMax}
          title={isMaximized ? "Restore" : "Maximize"}
          hoverClass="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {isMaximized ? <RestoreIcon /> : <Square className="size-3" />}
        </ChromeButton>
        <ChromeButton
          onClick={onClose}
          title="Close"
          hoverClass="hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="size-3.5" />
        </ChromeButton>
      </div>
    </div>
  );
}

function ChromeButton({
  onClick,
  title,
  hoverClass,
  children,
}: {
  onClick: () => void;
  title: string;
  hoverClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-full w-11 items-center justify-center text-sidebar-foreground transition-colors",
        hoverClass,
      )}
    >
      {children}
    </button>
  );
}

/** "Restore down" glyph: two overlapping squares. Lucide doesn't ship one. */
function RestoreIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="2.5" y="3.5" width="6" height="6" />
      <path d="M3.5 3.5 V2 H10 V8.5 H8.5" />
    </svg>
  );
}

function useIsMaximized() {
  const [isMax, setIsMax] = useState(false);
  useEffect(() => {
    const w = getCurrentWindow();
    let cancelled = false;
    void w.isMaximized().then((v) => {
      if (!cancelled) setIsMax(v);
    });
    const unlistenPromise = w.onResized(async () => {
      const v = await w.isMaximized();
      if (!cancelled) setIsMax(v);
    });
    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, []);
  return isMax;
}
