import { afterEach, describe, expect, it } from "vitest";
import { decryptTranscript, encryptTranscript, encryptionAvailable } from "./crypto.js";

const previous = process.env.DATA_ENCRYPTION_KEY;
afterEach(() => {
  if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = previous;
});

describe("ticket transcript encryption", () => {
  it("round-trips with AES-GCM and binds ciphertext to guild/ticket AAD", () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(encryptionAvailable()).toBe(true);
    const encrypted = encryptTranscript('{"messages":[]}', "guild:42");
    expect(encrypted.ciphertext).not.toContain("messages");
    expect(decryptTranscript(encrypted, "guild:42")).toBe('{"messages":[]}');
    expect(() => decryptTranscript(encrypted, "other:42")).toThrow();
  });

  it("refuses missing or malformed keys", () => {
    process.env.DATA_ENCRYPTION_KEY = "invalid";
    expect(encryptionAvailable()).toBe(false);
    expect(() => encryptTranscript("secret", "guild:1")).toThrow();
  });

  it("detects ciphertext and authentication-tag tampering", () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptTranscript("private transcript", "guild:7");
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
    };
    expect(() => decryptTranscript(tampered, "guild:7")).toThrow();
    expect(() =>
      decryptTranscript({ ...encrypted, tag: Buffer.alloc(16).toString("base64") }, "guild:7"),
    ).toThrow();
  });
});
