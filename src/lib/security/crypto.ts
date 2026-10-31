import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "../env";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const raw = getServerEnv().APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is required to encrypt provider tokens");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

/** Authenticated encryption for provider access and refresh tokens. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = envelope.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Unsupported or malformed encrypted secret");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
