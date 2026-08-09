import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const magic = Buffer.from("ASTRA01", "ascii");

export function parseBackupKey(value = process.env.BACKUP_ENCRYPTION_KEY) {
  if (!value) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32 ||
      key.toString("base64").replace(/=+$/u, "") !== value.trim().replace(/=+$/u, ""))
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptBackup(plaintext: Buffer, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(payload: Buffer, key: Buffer) {
  if (payload.length < magic.length + 12 + 16 ||
      !payload.subarray(0, magic.length).equals(magic))
    throw new Error("Backup format is invalid");
  const nonceStart = magic.length;
  const tagStart = nonceStart + 12;
  const ciphertextStart = tagStart + 16;
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

