import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../env";

const COOKIE_NAME = "wixhub_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionSignature(issuedAt: string): string {
  const secret = getServerEnv().SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(issuedAt).digest("base64url");
}

export function createAdminSessionValue(nowSeconds = Math.floor(Date.now() / 1000)): string {
  const issuedAt = String(nowSeconds);
  return `${issuedAt}.${sessionSignature(issuedAt)}`;
}

function isValidSession(value: string): boolean {
  const [issuedAt, signature, extra] = value.split(".");
  if (!issuedAt || !signature || extra !== undefined || !/^\d+$/.test(issuedAt)) return false;
  const issuedAtSeconds = Number(issuedAt);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds > now + 60 ||
      now - issuedAtSeconds > SESSION_TTL_SECONDS) return false;
  try {
    return equalSecret(sessionSignature(issuedAt), signature);
  } catch {
    return false;
  }
}

export function isAuthorizedAdmin(request: Request): boolean {
  const env = getServerEnv();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (env.ADMIN_API_KEY && supplied && equalSecret(env.ADMIN_API_KEY, supplied)) return true;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? isValidSession(decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1))) : false;
}

export function adminSessionCookieName() { return COOKIE_NAME; }
export function adminSessionMaxAge() { return SESSION_TTL_SECONDS; }
export function verifyDashboardPassword(candidate: string): boolean {
  const configured = getServerEnv().DASHBOARD_PASSWORD;
  return Boolean(configured && equalSecret(configured, candidate));
}
