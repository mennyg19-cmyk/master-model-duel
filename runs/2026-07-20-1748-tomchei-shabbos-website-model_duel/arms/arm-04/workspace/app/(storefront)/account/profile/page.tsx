import { getCustomerContext } from "@/lib/auth/customer-session";
import { ProfileForm } from "@/components/account/profile-form";

// Profile management (R-042): the form only ever updates the session
// customer's own row — ownership is enforced in the API, not the URL.
export default async function AccountProfilePage() {
  const customer = (await getCustomerContext())!;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <p className="text-sm text-muted">
        Signed in as {customer.email}. Email changes go through the office for now.
      </p>
      <ProfileForm initialName={customer.name} initialPhone={customer.phone} />
    </div>
  );
}
