"use client";
import { Sun, Moon } from "lucide-react";

export const THEME_KEY = "guardian:theme";
export type Theme = "light" | "dark";

/**
 * The inline script that runs before first paint, exported so the layout and
 * this component cannot disagree about the storage key or the default.
 *
 * Without it the page paints dark (the server-rendered default), then swaps to
 * light on hydration: a white flash on every navigation for anyone who chose
 * light. This has to be blocking and inline, which is the one place a raw
 * script tag earns its keep.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light")document.documentElement.classList.remove("dark");else document.documentElement.classList.add("dark")}catch(e){}})()`;

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode: the toggle still works for this page load
  }
}

// The icon and label follow the `dark` class the pre-paint script set, in CSS,
// so React keeps no copy of the theme that could disagree with the page.
export function ThemeToggle() {
  return (
    <button
      onClick={() => apply(document.documentElement.classList.contains("dark") ? "light" : "dark")}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-data text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
      <span className="sr-only">Switch to </span>
      <span className="hidden dark:inline">Light</span>
      <span className="dark:hidden">Dark</span>
      <span className="sr-only"> theme</span>
    </button>
  );
}
