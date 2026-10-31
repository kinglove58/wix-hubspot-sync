import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHubSpotContact } from "@/lib/providers/hubspot/client";
import { syncHubSpotContactToWix, syncWixContactToHubSpot } from "@/lib/sync/engine";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";
import { getServerEnv } from "@/lib/env";

export const runtime = "nodejs";

const inputSchema = z.object({
  provider: z.enum(["wix", "hubspot"]),
  contactId: z.string().min(1).max(256),
  instanceId: z.string().min(8).max(512).optional(),
});

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = inputSchema.parse(await request.json());
    const instanceId = input.instanceId ?? getServerEnv().WIX_INSTANCE_ID;
    if (!instanceId) return NextResponse.json({ error: "Wix instance ID is required" }, { status: 400 });

    if (input.provider === "wix") {
      const result = await syncWixContactToHubSpot(instanceId, input.contactId);
      return NextResponse.json(result);
    }

    const contact = await getHubSpotContact(input.contactId);
    if (!contact.id) return NextResponse.json({ error: "HubSpot contact was not found" }, { status: 404 });
    const result = await syncHubSpotContactToWix(instanceId, input.contactId, contact);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid sync request", details: error.flatten() }, { status: 400 });
    return NextResponse.json({ error: "Contact synchronization failed" }, { status: 502 });
  }
}
