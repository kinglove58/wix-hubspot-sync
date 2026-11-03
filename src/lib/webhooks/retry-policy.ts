import { ZodError } from "zod";
import { ProviderApiError, ProviderPreflightError } from "@/lib/providers/api-error";

export const MAX_ATTEMPTS = 5;
export function rootFailure(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof ProviderPreflightError; depth++) current = current.cause;
  return current;
}
export function isPermanentFailure(error: unknown): boolean {
  const cause = rootFailure(error);
  if (cause instanceof ZodError) return true;
  return cause instanceof ProviderApiError && cause.status >= 400 && cause.status < 500 &&
    ![408, 409, 412, 428, 429].includes(cause.status);
}
export function retryTransition(input: {
  outcome: "succeeded" | "ignored" | "pending" | "failed";
  attempts: number; permanent?: boolean; retryAfterSeconds?: number | null;
}): { attempts: number; delaySeconds: number | null; terminal: boolean } {
  if (!Number.isSafeInteger(input.attempts) || input.attempts < 1) throw new Error("Invalid processing attempt");
  if (input.outcome === "pending") return { attempts: input.attempts - 1, delaySeconds: 15, terminal: false };
  if (input.outcome !== "failed") return { attempts: input.attempts, delaySeconds: null, terminal: false };
  if (input.permanent || input.attempts >= MAX_ATTEMPTS) return { attempts: input.attempts, delaySeconds: null, terminal: true };
  const providerDelay = typeof input.retryAfterSeconds === "number" && Number.isFinite(input.retryAfterSeconds)
    ? Math.min(86_400, Math.max(0, Math.ceil(input.retryAfterSeconds))) : 0;
  return { attempts: input.attempts, delaySeconds: Math.max(Math.min(7200, 60 * 10 ** (input.attempts - 1)), providerDelay), terminal: false };
}
