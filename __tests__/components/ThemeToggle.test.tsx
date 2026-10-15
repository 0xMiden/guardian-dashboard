import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle, THEME_INIT_SCRIPT, THEME_KEY } from "@/components/layout/ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.add("dark");
});

describe("ThemeToggle", () => {
  // Which icon and label show is CSS (`dark:`), which jsdom does not apply, so
  // these check what the click does to the document.
  it("switches the document and remembers the choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("goes back", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));

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
