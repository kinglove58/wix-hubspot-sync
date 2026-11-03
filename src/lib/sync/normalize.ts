import type { WixContact } from "@/lib/providers/wix/contacts";
import type { HubSpotContact } from "@/lib/providers/hubspot/client";

function collectionItems<T>(value: { items: T[] } | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value?.items ?? [];
}

export function wixContactToHubSpotProperties(contact: WixContact): Record<string, string> {
  const emails = collectionItems(contact.info?.emails);
  const phones = collectionItems(contact.info?.phones);
  const email = emails.find((item) => item.primary)?.email ?? emails[0]?.email;
  const phone = phones.find((item) => item.primary)?.phone ?? phones[0]?.phone;
  const properties: Record<string, string> = {};
  if (email) properties.email = email;
  if (contact.info?.name?.first) properties.firstname = contact.info.name.first;
  if (contact.info?.name?.last) properties.lastname = contact.info.name.last;
  if (phone) properties.phone = phone;
  if (contact.info?.company) properties.company = contact.info.company;
  if (contact.info?.jobTitle) properties.jobtitle = contact.info.jobTitle;
  const mobile = phones.find((item) => item.tag === "MOBILE")?.phone;
  if (mobile) properties.mobilephone = mobile;
  const address = contact.info?.addresses?.items[0]?.address;
  if (address?.addressLine) properties.address = address.addressLine;
  else if (address?.streetAddress) properties.address = [address.streetAddress.number, address.streetAddress.name].filter(Boolean).join(" ");
  if (address?.city) properties.city = address.city;
  if (address?.subdivision) properties.state = address.subdivision;
  if (address?.postalCode) properties.zip = address.postalCode;
  if (address?.country) properties.country = address.country;
  return properties;
}

export function hubSpotContactToWixInfo(contact: HubSpotContact): NonNullable<WixContact["info"]> {
  const properties = contact.properties ?? {};
  const info: NonNullable<WixContact["info"]> = {};
  if (properties.firstname?.trim() || properties.lastname?.trim()) {
    info.name = {
      ...(properties.firstname?.trim() ? { first: properties.firstname } : {}),
      ...(properties.lastname?.trim() ? { last: properties.lastname } : {}),
    };
  }
  if (properties.email) info.emails = { items: [{ email: properties.email, primary: true }] };
  if (properties.phone) info.phones = { items: [{ phone: properties.phone, primary: true }] };
  if (properties.company) info.company = properties.company;
  if (properties.jobtitle) info.jobTitle = properties.jobtitle;
  if (properties.mobilephone) {
    info.phones ??= { items: [] };
    info.phones.items.push({ phone: properties.mobilephone, tag: "MOBILE" });
  }
  // HubSpot's country/state labels are not necessarily Wix ISO codes. Configure
  // those through validated mappings rather than guessing geographic values.
  if (properties.address || properties.city || properties.zip) {
    info.addresses = { items: [{ address: {
      ...(properties.address ? { addressLine: properties.address } : {}),
      ...(properties.city ? { city: properties.city } : {}),
      ...(properties.zip ? { postalCode: properties.zip } : {}),
    } }] };
  }
  return info;
}

/** A one-field mapping must not erase other collection entries or name fields. */
export function mergeWixInfo(current: NonNullable<WixContact["info"]>, patch: NonNullable<WixContact["info"]>): NonNullable<WixContact["info"]> {
  function merge(base: unknown, update: unknown): unknown {
    if (Array.isArray(base) && Array.isArray(update)) {
      const result = [...base];
      update.forEach((value, index) => { if (value !== undefined && value !== null) result[index] = merge(base[index], value); });
      return result;
    }
    if (base && update && typeof base === "object" && typeof update === "object" && !Array.isArray(base) && !Array.isArray(update)) {
      const result: Record<string, unknown> = { ...base };
      for (const [key, value] of Object.entries(update)) result[key] = merge(result[key], value);
      return result;
    }
    return update;
  }
  const result: NonNullable<WixContact["info"]> = {};
  for (const [key, value] of Object.entries(patch)) {
    // Send only requested top-level fields. Copying every current info field
    // would resubmit provider-managed extended fields such as subscriptions.
    result[key] = key === "extendedFields" ? value : merge(current[key], value);
  }
  return result;
}
