import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timestamp } from "@/components/ui/Timestamp";
import { formatTimestamp } from "@/lib/format";

describe("Timestamp", () => {
  // A client render is past hydration, which is the state every row in these
  // tables mounts in.
  it("shows the gap and keeps the exact time reachable", () => {
    const iso = new Date(Date.now() - 2 * 3600_000).toISOString();
    render(<Timestamp iso={iso} />);
    const el = screen.getByTitle(formatTimestamp(iso));
    expect(el).toHaveTextContent(/2 hours ago/);
    // Machine-readable alongside the human phrasing.
    expect(el).toHaveAttribute("dateTime", iso);
  });

  it("falls back to the date once the gap is too wide to phrase", () => {
    const iso = new Date(Date.now() - 30 * 86_400_000).toISOString();
    render(<Timestamp iso={iso} />);
    expect(screen.getByTitle(formatTimestamp(iso))).toHaveTextContent(formatTimestamp(iso));
  });
});
