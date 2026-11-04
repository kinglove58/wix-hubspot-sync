import { afterEach, describe, expect, it, vi } from "vitest";
import { getCustomerPublicConfig, isPublicSupabaseKey } from "../src/lib/security/customer-config";
const legacy = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
afterEach(() => vi.unstubAllEnvs());
describe("customer browser configuration", () => {
  it("accepts only public key classes and rejects privileged or malformed keys", () => {
    for (const key of ["sb_publishable_synthetic_customer_key", legacy("anon")]) expect(isPublicSupabaseKey(key)).toBe(true);
    for (const key of ["sb_secret_synthetic_customer_key", legacy("service_role"), "bad", "a.!!.c", "a.bnVsbA.c", "a.e30.c"]) expect(isPublicSupabaseKey(key)).toBe(false);
  });
  it("fails closed unless explicitly enabled with safe public configuration", () => {
    vi.stubEnv("CUSTOMER_ACCESS_ENABLED", "false"); expect(getCustomerPublicConfig()).toEqual({ enabled: false });
    vi.stubEnv("CUSTOMER_ACCESS_ENABLED", "true"); vi.stubEnv("SUPABASE_URL", "https://auth.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ""); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(getCustomerPublicConfig()).toEqual({ enabled: false });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_customer_key");
    expect(getCustomerPublicConfig()).toMatchObject({ enabled: true, publishableKey: "sb_publishable_synthetic_customer_key" });
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_publishable_synthetic_customer_key"); expect(getCustomerPublicConfig()).toEqual({ enabled: false });
    vi.stubEnv("SUPABASE_SECRET_KEY", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_synthetic_customer_key"); expect(getCustomerPublicConfig()).toEqual({ enabled: false });
  });
  it("permits HTTPS or loopback HTTP and excludes URL credentials and query data", () => {
    vi.stubEnv("CUSTOMER_ACCESS_ENABLED", "true"); vi.stubEnv("SUPABASE_SECRET_KEY", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ""); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", legacy("anon"));
    for (const url of ["https://auth.example.invalid", "http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"]) {
      vi.stubEnv("SUPABASE_URL", url); expect(getCustomerPublicConfig()).toMatchObject({ enabled: true });
    }
    for (const url of ["http://auth.example.invalid", "ftp://localhost", "https://user:pass@auth.example.invalid", "https://auth.example.invalid/?secret=x", "https://auth.example.invalid/#x"]) {
      vi.stubEnv("SUPABASE_URL", url); expect(getCustomerPublicConfig()).toEqual({ enabled: false });
    }
  });
});
