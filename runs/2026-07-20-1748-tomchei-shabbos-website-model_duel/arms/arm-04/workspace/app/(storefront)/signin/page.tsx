import { redirect } from "next/navigation";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { CustomerAuthForms } from "@/components/account/auth-forms";

export default async function SignInPage() {
  const customer = await getCustomerContext();
  if (customer) redirect("/account");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <CustomerAuthForms />
    </main>
  );
}
