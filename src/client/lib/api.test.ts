import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard API client", () => {
  it("sets JSON content type and returns response data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(api<{ ok: boolean }>("/api/test", { method: "POST", body: "{}" }))
      .resolves.toEqual({ ok: true });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("surfaces JSON and text error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Denied" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ).mockResolvedValueOnce(new Response("Gateway unavailable", { status: 502 })),
    );
    await expect(api("/api/denied")).rejects.toThrow("Denied");
    await expect(api("/api/down")).rejects.toThrow("Gateway unavailable");
  });

  it("returns undefined for successful empty responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api("/api/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});
