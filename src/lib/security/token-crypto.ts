import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function decodeKey(encodedKey: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(encodedKey)
    ? Buffer.from(encodedKey, "hex")
    : Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");
  }

  return key;
}

function getKey(): Buffer {
  const encodedKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encodedKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required for token encryption");
  }
  return decodeKey(encodedKey);
}

/**
 * Encrypts an OAuth token using AES-256-GCM.
 * Stored format: v1.<iv>.<auth-tag>.<ciphertext> (base64url segments).
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty token");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Decrypts a token produced by encryptToken and rejects altered payloads. */
export function decryptToken(envelope: string): string {
  const [version, ivPart, tagPart, ciphertextPart, extra] = envelope.split(".");
  if (
    version !== VERSION ||
    !ivPart ||
    !tagPart ||
    ciphertextPart === undefined ||
    extra !== undefined
  ) {
    throw new Error("Unsupported or malformed encrypted token");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed encrypted token");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
