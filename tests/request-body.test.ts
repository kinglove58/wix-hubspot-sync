import { describe, expect, it } from "vitest";
import { readBoundedBody } from "../src/lib/security/request-body";

describe("bounded raw request bodies", () => {
  it("preserves signature input exactly", async () => {
    const body = " {\n\"name\":\"é\" } ";
    expect(await readBoundedBody(new Request("https://example.invalid", { method: "POST", body }), 100)).toBe(body);
  });
  it("counts UTF-8 bytes, not characters", async () => {
    await expect(readBoundedBody(new Request("https://example.invalid", { method: "POST", body: "éé" }), 3)).rejects.toMatchObject({ status: 413 });
  });
  it("stops chunked streams at the byte limit and rejects invalid UTF-8", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); controller.close(); } });
    const request = { headers: new Headers(), body: stream } as Request;
    await expect(readBoundedBody(request, 5)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedBody(new Request("https://example.invalid", { method: "POST", body: new Uint8Array([255]) }), 10)).rejects.toMatchObject({ status: 400 });
  });
});
