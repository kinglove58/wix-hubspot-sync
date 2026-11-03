import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("../src/lib/webhooks/processor", () => ({ processWebhookEvent: m.process }));
import { POST } from "../src/app/api/worker/process/route";

describe("manual worker boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "cron-secret"); m.process.mockResolvedValue("succeeded"); });
  afterEach(() => vi.unstubAllEnvs());
  function request(eventIds: string[], secret = "cron-secret") {
    return new NextRequest("https://sync.example.invalid/api/worker/process", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ eventIds }) });
  }
  it("rejects unauthorized requests and malformed UUIDs before processing", async () => {
    expect((await POST(request([], "wrong"))).status).toBe(401);
    expect((await POST(request(["-".repeat(36)]))).status).toBe(400);
    expect(m.process).not.toHaveBeenCalled();
  });
  it("deduplicates supplied IDs and reports processing failures", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect((await POST(request([id, id]))).status).toBe(200);
    expect(m.process).toHaveBeenCalledTimes(1);
    m.process.mockRejectedValue(new Error("failed"));
    expect((await POST(request([id]))).status).toBe(207);
  });
});
