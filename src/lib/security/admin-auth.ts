import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../env";

export function isAuthorizedAdmin(request: Request): boolean {
  const configured = getServerEnv().ADMIN_API_KEY;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
