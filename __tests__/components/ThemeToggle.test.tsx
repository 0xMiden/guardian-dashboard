import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle, THEME_INIT_SCRIPT, THEME_KEY } from "@/components/layout/ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.add("dark");
});

describe("ThemeToggle", () => {
  it("offers the theme you are not in", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  });

  // The label is read back off the document rather than from a second copy of
  // the truth in component state, so it cannot drift from what is rendered.
  // MutationObserver delivers on a microtask, hence the await; in a browser
  // that is one frame and invisible.
  it("switches the document and remembers the choice", async () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /switch to light/i }));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(await screen.findByRole("button", { name: /switch to dark/i })).toBeInTheDocument();
  });

  it("goes back", async () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /switch to light/i }));
    fireEvent.click(await screen.findByRole("button", { name: /switch to dark/i }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  // The script runs before first paint. If it disagreed with the toggle about
  // the key or the default, a light user would get a dark flash on every
  // navigation, so both read the same exported constant.
  it("the pre-paint script uses the same key and defaults to dark", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_KEY));

    localStorage.setItem(THEME_KEY, "light");
    document.documentElement.classList.add("dark");
    eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    localStorage.removeItem(THEME_KEY);
    eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
