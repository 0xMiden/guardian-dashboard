import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { LoadMoreSentinel } from "@/components/ui/TableControls";

type Callback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { cb: Callback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(cb: Callback) { observers.push({ cb, observe: this.observe, disconnect: this.disconnect }); }
  });
});
afterEach(() => vi.unstubAllGlobals());

const inView = (i: number) => observers[i].cb([{ isIntersecting: true }]);

describe("LoadMoreSentinel", () => {
  it("asks for the next page when it scrolls into view", () => {
    const onLoadMore = vi.fn(async () => {});
    render(<LoadMoreSentinel hasMore loading={false} onLoadMore={onLoadMore} />);
    inView(0);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  // The observer fires on a visibility change only. A page whose rows all fell
  // to a client-side filter leaves the sentinel where it was, on screen, so
  // without a re-arm it would never ask for the page after that one.
  it("asks again after a page lands while it is still on screen", () => {
    const onLoadMore = vi.fn(async () => {});
    const { rerender } = render(<LoadMoreSentinel hasMore loading={false} onLoadMore={onLoadMore} />);
    inView(0);
    rerender(<LoadMoreSentinel hasMore loading onLoadMore={onLoadMore} />);
    rerender(<LoadMoreSentinel hasMore loading={false} onLoadMore={onLoadMore} />);
    expect(observers.length).toBeGreaterThan(1);
    inView(observers.length - 1);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("is absent once there is nothing more to load", () => {
    const { container } = render(<LoadMoreSentinel hasMore={false} loading={false} onLoadMore={async () => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(observers).toHaveLength(0);
  });
});
