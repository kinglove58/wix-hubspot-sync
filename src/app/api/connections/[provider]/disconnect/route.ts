import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { disconnectProvider } from "@/lib/providers/connections";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { provider } = await context.params;
  if (provider !== "wix" && provider !== "hubspot") return NextResponse.json({ error: "Unsupported provider" }, { status: 404 });
  try {
    const body = z.object({ externalAccountId: z.string().min(1) }).parse(await request.json());
    await disconnectProvider(provider, body.externalAccountId);
    return NextResponse.json({ disconnected: true });
  } catch {
    return NextResponse.json({ error: "Unable to disconnect provider" }, { status: 400 });
  }
}
