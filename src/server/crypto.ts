import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const supplied = process.env.DATA_ENCRYPTION_KEY;
  if (!supplied) return null;
  const key = Buffer.from(supplied, "base64");
  return key.length === 32 ? key : null;
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
  const key = encryptionKey();
  if (!key) throw new Error("Transcript encryption is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.nonce, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
