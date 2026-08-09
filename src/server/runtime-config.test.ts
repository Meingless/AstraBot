import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./runtime-config.js";

const production = {
  NODE_ENV: "production",
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_REDIRECT_URI: "https://astra.example/api/auth/callback",
  SESSION_SECRET: "s".repeat(32),
  METRICS_TOKEN: "m".repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
  APP_DOMAIN: "astra.example",
  BACKUP_ENABLED: "false",
};

describe("runtime configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(validateRuntimeConfig(production)).toEqual({
      token: "token",
      clientId: "client",
      port: 3000,
    });
  });

  it.each([
    ["SESSION_SECRET", "short"],
    ["METRICS_TOKEN", "short"],
    ["DATA_ENCRYPTION_KEY", "invalid"],
    ["DISCORD_REDIRECT_URI", "http://astra.example/api/auth/callback"],
    ["APP_DOMAIN", "other.example"],
  ])("rejects unsafe production %s", (key, value) => {
    expect(() => validateRuntimeConfig({ ...production, [key]: value }))
      .toThrow();
  });

  it("requires independent production secrets", () => {
    expect(() => validateRuntimeConfig({
      ...production,
      METRICS_TOKEN: production.SESSION_SECRET,
    })).toThrow(/must be different/u);
  });

  it("keeps local development configuration minimal", () => {
    expect(validateRuntimeConfig({
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "client",
      PORT: "4321",
    }).port).toBe(4321);
  });

  it("requires a separate backup encryption key", () => {
    expect(() => validateRuntimeConfig({
      ...production,
      BACKUP_ENABLED: "true",
      BACKUP_ENCRYPTION_KEY: production.DATA_ENCRYPTION_KEY,
    })).toThrow(/must differ/u);
  });

  it("validates enabled backup settings before production starts", () => {
    expect(() => validateRuntimeConfig({
      ...production,
      BACKUP_ENABLED: "true",
      BACKUP_ENCRYPTION_KEY: "invalid",
    })).toThrow(/BACKUP_ENCRYPTION_KEY/u);

    expect(() => validateRuntimeConfig({
      ...production,
      BACKUP_ENABLED: "true",
      BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      BACKUP_INTERVAL_HOURS: "0",
    })).toThrow(/BACKUP_INTERVAL_HOURS/u);
  });

  it("rejects incomplete S3 backup settings", () => {
    expect(() => validateRuntimeConfig({
      ...production,
      BACKUP_S3_BUCKET: "astra-backups",
    })).toThrow(/S3 backup configuration/u);
    expect(() => validateRuntimeConfig({
      ...production,
      BACKUP_S3_ENDPOINT: "http://minio.internal:9000",
    })).toThrow(/HTTPS/u);
  });
});
