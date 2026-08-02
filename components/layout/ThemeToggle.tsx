"use client";
import { useSyncExternalStore } from "react";
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

// Reads the class the pre-paint script already set, rather than keeping a
// second copy of the truth in React state that could disagree with the DOM.
const subscribe = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => o.disconnect();
};
const getSnapshot = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
// Dark is what the server renders, so that is what hydration must agree with.
const getServerSnapshot = (): Theme => "dark";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      onClick={() => apply(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-data text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
