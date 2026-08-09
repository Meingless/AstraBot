import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("production HTTP security policy", () => {
  let app: ReturnType<(typeof import("./web.js"))["createWebServer"]>;

  beforeAll(async () => {
    process.env.ASTRA_DB_PATH = path.join(
      mkdtempSync(path.join(tmpdir(), "astra-production-")),
      "test.db",
    );
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "production-test-secret";
    process.env.APP_DOMAIN = "astra.example";
    delete process.env.DATA_ENCRYPTION_KEY;
    vi.resetModules();
    const { createWebServer } = await import("./web.js");
    app = createWebServer();
  });

  afterAll(() => {
    delete process.env.NODE_ENV;
    delete process.env.APP_DOMAIN;
  });

  it("rejects cross-origin state-changing API requests", async () => {
    await request(app)
      .post("/api/auth/logout")
      .set("Origin", "https://attacker.example")
      .expect(403, { error: "Request origin is not allowed" });
  });

  it("rejects state-changing requests without an Origin header", async () => {
    await request(app)
      .post("/api/auth/logout")
      .expect(403, { error: "Request origin is not allowed" });
  });

  it("sets CSP/clickjacking headers and hides the framework signature", async () => {
    const response = await request(app).get("/health/live").expect(200);
    expect(response.headers).not.toHaveProperty("x-powered-by");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("fails readiness when Discord or transcript encryption is unavailable", async () => {
    const response = await request(app).get("/health/ready").expect(503);
    expect(response.body.checks).toMatchObject({
      database: true,
      discord: false,
      encryption: false,
    });
  });
});
