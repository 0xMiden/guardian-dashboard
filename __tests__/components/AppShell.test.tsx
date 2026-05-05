import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/layout/AppShell";

vi.mock("@clerk/nextjs", () => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
  useClerk: vi.fn(() => ({ signOut: vi.fn() })),
}));

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/overview"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

const { useAuth, useUser } = await import("@clerk/nextjs");

beforeEach(() => vi.clearAllMocks());

describe("AppShell", () => {
  it("shows Admin nav item for admin users", () => {
    vi.mocked(useAuth).mockReturnValue({ userId: "admin_123" } as any);
    vi.mocked(useUser).mockReturnValue({
      user: { publicMetadata: { role: "admin" } },
    } as any);
    render(<AppShell><div>content</div></AppShell>);
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("hides Admin nav item for viewer users", () => {
    vi.mocked(useAuth).mockReturnValue({ userId: "viewer_123" } as any);
    vi.mocked(useUser).mockReturnValue({
      user: { publicMetadata: { role: "viewer" } },
    } as any);
    render(<AppShell><div>content</div></AppShell>);
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("renders children without sidebar on auth pages", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/sign-in");
    vi.mocked(useAuth).mockReturnValue({ userId: null } as any);
    vi.mocked(useUser).mockReturnValue({ user: null } as any);
    render(<AppShell><div>sign-in content</div></AppShell>);
    expect(screen.getByText("sign-in content")).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });
});
