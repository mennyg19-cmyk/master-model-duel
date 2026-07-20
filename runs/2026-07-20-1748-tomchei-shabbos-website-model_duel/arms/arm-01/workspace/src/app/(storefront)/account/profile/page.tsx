import { notFound } from "next/navigation";
import { ProfileEditor } from "@/components/profile-editor";
import { getAuthenticatedCustomer } from "@/lib/customer-access";

export const dynamic = "force-dynamic";

export default async function AccountProfilePage() {
  const account = await getAuthenticatedCustomer();
  if (!account?.customer) notFound();
  return <ProfileEditor customer={account.customer} />;
}
