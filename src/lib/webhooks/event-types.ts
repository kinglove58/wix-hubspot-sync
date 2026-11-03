export function isWixContactEvent(type: string): boolean {
  return ["wix.contacts.v4.contact_created", "wix.contacts.v4.contact_updated"].includes(type);
}

export function isHubSpotContactEvent(type: string, payload: Record<string, unknown>): boolean {
  if (["contact.creation", "contact.propertyChange"].includes(type)) {
    return payload.objectTypeId === undefined || payload.objectTypeId === "0-1";
  }
  return ["object.creation", "object.propertyChange"].includes(type) && payload.objectTypeId === "0-1";
}
