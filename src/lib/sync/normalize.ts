import type { WixContact } from "@/lib/providers/wix/contacts";
import type { HubSpotContact } from "@/lib/providers/hubspot/client";

export function wixContactToHubSpotProperties(contact: WixContact): Record<string, string> {
  const email = contact.info?.emails?.find((item) => item.primary)?.email ??
    contact.info?.emails?.[0]?.email;
  const phone = contact.info?.phones?.find((item) => item.primary)?.phone ??
    contact.info?.phones?.[0]?.phone;
  const properties: Record<string, string> = {};
  if (email) properties.email = email;
  if (contact.info?.name?.first) properties.firstname = contact.info.name.first;
  if (contact.info?.name?.last) properties.lastname = contact.info.name.last;
  if (phone) properties.phone = phone;
  if (contact.info?.company) properties.company = contact.info.company;
  return properties;
}

export function hubSpotContactToWixInfo(contact: HubSpotContact): NonNullable<WixContact["info"]> {
  const properties = contact.properties ?? {};
  const info: NonNullable<WixContact["info"]> = {};
  if (properties.firstname || properties.lastname) {
    info.name = { first: properties.firstname ?? "", last: properties.lastname ?? "" };
  }
  if (properties.email) info.emails = [{ email: properties.email, primary: true }];
  if (properties.phone) info.phones = [{ phone: properties.phone, primary: true }];
  if (properties.company) info.company = properties.company;
  return info;
}
