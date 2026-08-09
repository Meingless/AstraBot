import { Buffer } from "node:buffer";

export type RuntimeConfig = {
  token: string;
  clientId: string;
  port: number;
};

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function validBase64Key(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim();
  try {
    const decoded = Buffer.from(normalized, "base64");
    return decoded.length === 32 &&
      decoded.toString("base64").replace(/=+$/u, "") ===
        normalized.replace(/=+$/u, "");
  } catch {
    return false;
  }
}

function positiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const value = Number(env[key] || fallback);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${key} must be a positive number`);
}

export function validateRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const token = required(env, "DISCORD_TOKEN");
  const clientId = required(env, "DISCORD_CLIENT_ID");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be an integer between 1 and 65535");

  if (env.NODE_ENV === "production") {
    required(env, "DISCORD_CLIENT_SECRET");
    const redirect = required(env, "DISCORD_REDIRECT_URI");
    const sessionSecret = required(env, "SESSION_SECRET");
    const metricsToken = required(env, "METRICS_TOKEN");
    const domain = required(env, "APP_DOMAIN").toLowerCase();
    if (sessionSecret.length < 32)
      throw new Error("SESSION_SECRET must contain at least 32 characters");
    if (metricsToken.length < 32)
      throw new Error("METRICS_TOKEN must contain at least 32 characters");
    if (metricsToken === sessionSecret)
      throw new Error("METRICS_TOKEN and SESSION_SECRET must be different");
    if (!validBase64Key(env.DATA_ENCRYPTION_KEY))
      throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    if (env.BACKUP_ENABLED === "true") {
      if (!validBase64Key(env.BACKUP_ENCRYPTION_KEY))
        throw new Error(
          "BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key when backups are enabled",
        );
      if (Buffer.from(env.BACKUP_ENCRYPTION_KEY!, "base64").equals(
        Buffer.from(env.DATA_ENCRYPTION_KEY!, "base64"),
      ))
        throw new Error("BACKUP_ENCRYPTION_KEY must differ from DATA_ENCRYPTION_KEY");
      positiveNumber(env, "BACKUP_INTERVAL_HOURS", 24);
      positiveNumber(env, "BACKUP_RETENTION_DAYS", 7);
    }
    const s3Keys = [
      "BACKUP_S3_BUCKET",
      "BACKUP_S3_REGION",
      "BACKUP_S3_ACCESS_KEY_ID",
      "BACKUP_S3_SECRET_ACCESS_KEY",
    ] as const;
    const configuredS3Keys = s3Keys.filter((key) => Boolean(env[key]?.trim()));
    if (configuredS3Keys.length > 0 && configuredS3Keys.length !== s3Keys.length)
      throw new Error(`S3 backup configuration requires ${s3Keys.join(", ")}`);
    if (env.BACKUP_S3_ENDPOINT) {
      let endpoint: URL;
      try {
        endpoint = new URL(env.BACKUP_S3_ENDPOINT);
      } catch {
        throw new Error("BACKUP_S3_ENDPOINT must be a valid HTTPS URL");
      }
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password
      )
        throw new Error("BACKUP_S3_ENDPOINT must be a credential-free HTTPS URL");
    }
    let callback: URL;
    try {
      callback = new URL(redirect);
    } catch {
      throw new Error("DISCORD_REDIRECT_URI must be a valid URL");
    }
    if (callback.protocol !== "https:" || callback.hostname.toLowerCase() !== domain)
      throw new Error("DISCORD_REDIRECT_URI must use HTTPS and match APP_DOMAIN");
  }
  return { token, clientId, port };
}
