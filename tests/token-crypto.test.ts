import { afterEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src/lib/security/token-crypto";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("OAuth token encryption", () => {
  it("encrypts and decrypts a token without storing plaintext", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    const token = "sample-access-token-do-not-log";
    const encrypted = encryptToken(token);

    expect(encrypted).not.toContain(token);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it("uses a fresh nonce for each encryption", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
    expect(encryptToken("same-token")).not.toBe(encryptToken("same-token"));
  });

  it("rejects tampered ciphertext", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "c".repeat(64);
    const encrypted = encryptToken("secret-token");
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("rejects missing or incorrectly sized keys", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("secret")).toThrow(/TOKEN_ENCRYPTION_KEY is required/);
    process.env.TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => encryptToken("secret")).toThrow(/exactly 32 bytes/);
  });
});
