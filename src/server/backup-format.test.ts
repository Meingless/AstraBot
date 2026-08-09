import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, parseBackupKey } from "./backup-format.js";

describe("encrypted backups", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips backup bytes", () => {
    const source = Buffer.from("SQLite format backup bytes");
    expect(decryptBackup(encryptBackup(source, key), key)).toEqual(source);
  });

  it("rejects tampering and the wrong key", () => {
    const encrypted = encryptBackup(Buffer.from("database"), key);
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptBackup(encrypted, key)).toThrow();
    expect(() => decryptBackup(encryptBackup(Buffer.from("database"), key), Buffer.alloc(32, 8)))
      .toThrow();
  });

  it("validates the environment key exactly", () => {
    expect(parseBackupKey(key.toString("base64"))).toEqual(key);
    expect(() => parseBackupKey("invalid")).toThrow(/32-byte/u);
  });
});
