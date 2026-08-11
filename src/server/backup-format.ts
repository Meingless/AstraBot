import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("ASTRA01", "ascii");
const nonceLength = 12;
const tagLength = 16;
const headerLength = magic.length + nonceLength + tagLength;

function parseKey(value: string, variable: string) {
  const normalized = value.trim();
  const key = Buffer.from(normalized, "base64");
  if (
    key.length !== 32 ||
    key.toString("base64").replace(/=+$/u, "") !== normalized.replace(/=+$/u, "")
  )
    throw new Error(`${variable} must be a base64-encoded 32-byte key`);
  return key;
}

export function parseBackupKey(value = process.env.BACKUP_ENCRYPTION_KEY) {
  if (!value) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  return parseKey(value, "BACKUP_ENCRYPTION_KEY");
}

export function parseBackupKeys() {
  const active = parseBackupKey();
  const previous = (process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseKey(value, "BACKUP_ENCRYPTION_PREVIOUS_KEYS"));
  return [active, ...previous];
}

export function encryptBackup(plaintext: Buffer, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(payload: Buffer, key: Buffer) {
  if (payload.length < headerLength ||
      !payload.subarray(0, magic.length).equals(magic))
    throw new Error("Backup format is invalid");
  const nonceStart = magic.length;
  const tagStart = nonceStart + nonceLength;
  const ciphertextStart = tagStart + tagLength;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    payload.subarray(nonceStart, tagStart),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));
  return Buffer.concat([
    decipher.update(payload.subarray(ciphertextStart)),
    decipher.final(),
  ]);
}

export async function encryptBackupFile(source: string, destination: string, key: Buffer) {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  await writeFile(
    destination,
    Buffer.concat([magic, nonce, Buffer.alloc(tagLength)]),
    { mode: 0o600 },
  );
  try {
    await pipeline(
      createReadStream(source),
      cipher,
      createWriteStream(destination, { flags: "a", mode: 0o600 }),
    );
    const handle = await open(destination, "r+");
    try {
      await handle.write(cipher.getAuthTag(), 0, tagLength, magic.length + nonceLength);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }
}

export async function decryptBackupFile(
  source: string,
  destination: string,
  keys: Buffer[],
) {
  if (!keys.length) throw new Error("At least one backup encryption key is required");
  const fileSize = (await stat(source)).size;
  if (fileSize < headerLength) throw new Error("Backup format is invalid");
  const handle = await open(source, "r");
  const header = Buffer.alloc(headerLength);
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.subarray(0, magic.length).equals(magic))
      throw new Error("Backup format is invalid");
  } finally {
    await handle.close();
  }
  const nonce = header.subarray(magic.length, magic.length + nonceLength);
  const tag = header.subarray(magic.length + nonceLength, headerLength);
  let lastError: unknown;
  for (const key of keys) {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(magic);
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(source, { start: headerLength }),
        decipher,
        createWriteStream(destination, { flags: "w", mode: 0o600 }),
      );
      return;
    } catch (error) {
      lastError = error;
      await unlink(destination).catch(() => undefined);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Backup authentication failed");
}
