import CustomerWorkspace from "@/components/customer-workspace";
import { getCustomerPublicConfig } from "@/lib/security/customer-config";

export const dynamic = "force-dynamic";

export default function CustomerPage() {
  return <CustomerWorkspace config={getCustomerPublicConfig()} />;
}
