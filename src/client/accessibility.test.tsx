// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("public page accessibility", () => {
  it.each(["/features", "/privacy", "/missing-page"])("has no detectable axe violations on %s", async (route) => {
    window.history.pushState({}, "", route);
    const { container } = render(<App />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no detectable axe violations on the unauthenticated landing page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { container } = render(<App />);
    await waitFor(() =>
      expect(container.querySelector(".landing")).not.toBeNull(),
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
