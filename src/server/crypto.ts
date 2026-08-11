import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function parseKey(supplied: string | undefined) {
  if (!supplied) return null;
  const normalized = supplied.trim();
  const key = Buffer.from(normalized, "base64");
  return key.length === 32 &&
    key.toString("base64").replace(/=+$/u, "") === normalized.replace(/=+$/u, "")
    ? key
    : null;
}

function encryptionKey() {
  return parseKey(process.env.DATA_ENCRYPTION_KEY);
}

function decryptionKeys() {
  const active = encryptionKey();
  if (!active) return [];
  const previous: NonNullable<ReturnType<typeof parseKey>>[] = [];
  for (const value of (process.env.DATA_ENCRYPTION_PREVIOUS_KEYS || "").split(",")) {
    const key = parseKey(value);
    if (key) previous.push(key);
  }
  return [active, ...previous];
}

export function encryptionAvailable() {
  return encryptionKey() !== null;
}

export function encryptTranscript(plaintext: string, aad: string) {
  const key = encryptionKey();
  if (!key) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptTranscript(
  encrypted: { ciphertext: string; nonce: string; tag: string },
  aad: string,
) {
  const keys = decryptionKeys();
  if (!keys.length) throw new Error("Transcript encryption is unavailable");
  let lastError: unknown;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(encrypted.nonce, "base64"),
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Transcript decryption failed");
}
