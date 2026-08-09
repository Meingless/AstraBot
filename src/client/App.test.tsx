// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { defaultConfig } from "../server/config";
import type { GuildData } from "./types";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("dashboard public routes", () => {
  it("renders the Turkish privacy notice from browser locale", () => {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "tr-TR",
    });
    window.history.pushState({}, "", "/privacy");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Veriniz üzerinde kontrol sizde." })).toBeInTheDocument();
    expect(screen.getByText(/AES-256-GCM/)).toBeInTheDocument();
  });

  it("renders the feature route without authentication", () => {
    window.history.pushState({}, "", "/features");
    render(<App />);
    expect(screen.getByRole("heading", { name: /A calmer server.*A stronger orbit/i }))
      .toBeInTheDocument();
  });

  it("renders a real not-found page for unknown routes", () => {
    window.history.pushState({}, "", "/missing-page");
    render(<App />);
    expect(screen.getByRole("heading", { name: "This page drifted out of range." }))
      .toBeInTheDocument();
    expect(document.title).toBe("Page not found — Astra");
  });

  it("falls back to the landing page when no dashboard session exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Launch Astra/i })).toHaveAttribute(
        "href",
        "/api/auth/login",
      ),
    );
  });

  it("renders the restricted moderator workspace and its fetched records", async () => {
    const guildId = "123456789012345678";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/me")
          return Promise.resolve(json({
            user: { id: "user", username: "moderator", avatar: null },
            guilds: [{
              id: guildId,
              name: "Orbit",
              icon: null,
              owner: false,
              permissions: "0",
              botPresent: true,
              accessLevel: "moderator",
            }],
          }));
        if (url.endsWith("/moderation"))
          return Promise.resolve(json({
            cases: [{ id: 1, target_id: "target", moderator_id: "mod", action: "warn", reason: "reason", created_at: 1 }],
            auditEvents: [],
          }));
        return Promise.resolve(json({
          tickets: [{
            id: 2,
            guildId,
            channelId: "channel",
            ownerId: "owner",
            ownerName: "Member",
            assigneeId: null,
            status: "open",
            createdAt: 1,
            assignedAt: null,
            closedAt: null,
            transcriptExpiresAt: null,
            hasTranscript: false,
          }],
        }));
      }),
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Cases and support operations." }))
      .toBeInTheDocument();
    expect(await screen.findByText(/#2 · open · Member/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("renders the full administrator settings payload", async () => {
    const guildId = "223456789012345678";
    const guildData: GuildData = {
      config: { ...defaultConfig },
      subscription: { plan: "free", status: "active", startsAt: 1, expiresAt: null },
      capabilities: {
        welcomeGoodbye: true,
        autoRole: true,
        basicAutomod: true,
        logs: true,
        moderationCommands: true,
        reactionRoles: true,
        customCommands: true,
        joinGuard: false,
        eventMessages: false,
        advancedAutomod: false,
        aiCommands: false,
        tickets: false,
      },
      limits: {
        reactionRoles: 1,
        customCommands: 3,
        moderationCases: 10,
        aiCommandsPerDay: 0,
      },
      premium: false,
      stats: { members: 10, channels: 3, roles: 2 },
      channels: [{ id: "channel", name: "general" }],
      categories: [],
      roles: [{ id: "role", name: "Member", color: "#ffffff" }],
      reactionRoles: [],
      customCommands: [],
      cases: [],
      auditEvents: [],
      tickets: [],
      transcriptEncryptionAvailable: true,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === "/api/me")
          return Promise.resolve(json({
            user: { id: "owner", username: "owner", avatar: null },
            guilds: [{
              id: guildId,
              name: "Admin Guild",
              icon: null,
              owner: true,
              permissions: "0",
              botPresent: true,
              accessLevel: "admin",
            }],
          }));
        return Promise.resolve(json(guildData));
      }),
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Setup and access" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});
