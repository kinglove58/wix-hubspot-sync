import "server-only";
import { NextResponse } from "next/server";
import { CustomerAccessError } from "@/lib/security/customer-auth";
import { logOperationFailure } from "@/lib/security/log";
import { readBoundedBody, RequestBodyError } from "@/lib/security/request-body";

export async function readCustomerJson(request: Request): Promise<unknown> {
  const raw = await readBoundedBody(request, 32_768);
  try { return JSON.parse(raw) as unknown; }
  catch { throw new CustomerAccessError(400, "Invalid JSON body"); }
}

export function customerFailure(error: unknown, operation: string) {
  if (error instanceof RequestBodyError) return NextResponse.json({ error: "Invalid request body" }, { status: error.status });
  if (error instanceof CustomerAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  logOperationFailure("CUSTOMER_REQUEST_FAILED", { operation, result: "failed" });
  return NextResponse.json({ error: "Unable to complete customer request" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
