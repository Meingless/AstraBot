import { chmodSync, createReadStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { encryptBackupFile, parseBackupKey } from "./backup-format.js";
import { createConsistentBackup } from "./database.js";
import { gauge, increment, log } from "./observability.js";

type BackupOptions = {
  directory?: string;
  retentionDays?: number;
  now?: Date;
  upload?: (file: string) => Promise<void>;
};

let lastBackupSuccessful: boolean | null = null;

export function backupHealthy() {
  return process.env.BACKUP_ENABLED !== "true" || lastBackupSuccessful === true;
}

function timestamp(date: Date) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function rotateBackups(
  directory: string,
  retentionDays: number,
  now = Date.now(),
) {
  const threshold = now - retentionDays * 86_400_000;
  let removed = 0;
  for (const entry of readdirSync(directory)) {
    if (!/^astra-.*\.db\.enc$/u.test(entry)) continue;
    const file = path.join(directory, entry);
    if (statSync(file).mtimeMs >= threshold) continue;
    unlinkSync(file);
    removed += 1;
  }
  return removed;
}

function s3Uploader() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim();
  const bucket = process.env.BACKUP_S3_BUCKET?.trim();
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
  const region = process.env.BACKUP_S3_REGION?.trim();
  const supplied = [endpoint, bucket, accessKeyId, secretAccessKey, region]
    .some(Boolean);
  if (!supplied) return undefined;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !region)
    throw new Error("All BACKUP_S3_* settings are required when off-site export is enabled");
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId, secretAccessKey },
  });
  return async (file: string) => {
    const prefix = (process.env.APP_DOMAIN || "astra").replace(/[^a-z0-9.-]/giu, "-");
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/${path.basename(file)}`,
      Body: createReadStream(file),
      ContentType: "application/octet-stream",
    }));
  };
}

export async function runBackup(options: BackupOptions = {}) {
  const directory = path.resolve(
    options.directory || process.env.BACKUP_DIRECTORY || "backups",
  );
  const retentionDays = options.retentionDays ??
    Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 7));
  const now = options.now || new Date();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const name = `astra-${timestamp(now)}.db.enc`;
  const destination = path.join(directory, name);
  const temporaryDatabase = path.join(directory, `.${name}.db.tmp`);
  const temporaryEncrypted = `${destination}.tmp`;
  try {
    createConsistentBackup(temporaryDatabase);
    await encryptBackupFile(temporaryDatabase, temporaryEncrypted, parseBackupKey());
    renameSync(temporaryEncrypted, destination);
    chmodSync(destination, 0o600);
    const removed = rotateBackups(directory, retentionDays, now.getTime());
    const upload = options.upload || s3Uploader();
    let offsite = false;
    if (upload) {
      try {
        await upload(destination);
        offsite = true;
        gauge("backup_last_offsite_success_timestamp", Math.floor(now.getTime() / 1000));
      } catch (error) {
        increment("backup_offsite_failures_total");
        log("error", "backup_offsite_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    gauge("backup_last_local_success_timestamp", Math.floor(now.getTime() / 1000));
    lastBackupSuccessful = !upload || offsite;
    log("info", "backup_completed", { file: name, removed, offsite });
    return { file: destination, removed, offsite };
  } catch (error) {
    lastBackupSuccessful = false;
    increment("backup_failures_total");
    throw error;
  } finally {
    for (const file of [temporaryDatabase, temporaryEncrypted]) {
      try { unlinkSync(file); } catch { /* already absent */ }
    }
  }
}
