import type { Metadata } from "next";
import { requireCustomer } from "@/lib/customers/session";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

// R-042: profile management. The form can only ever touch the session's own
// customer row — the API has no id parameter to abuse.
export default async function ProfilePage() {
  const ctx = await requireCustomer();

  return (
    <div className="max-w-md" data-account-profile>
      <h2 className="text-lg font-semibold text-stone-900">Profile</h2>
      <p className="mt-1 text-sm text-stone-600">
        Your name, email, and phone are how we match your orders and saved addresses to you.
      </p>
      <ProfileForm
        initialName={ctx.customer.name}
        initialEmail={ctx.customer.email}
        initialPhone={ctx.customer.phone ?? ""}
      />
    </div>
  );
}
