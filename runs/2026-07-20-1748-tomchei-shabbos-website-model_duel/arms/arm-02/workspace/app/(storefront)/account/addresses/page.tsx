import { getCustomerContext } from "@/lib/auth/customer-session";
import { getCustomerAddressBook } from "@/lib/addresses/book";
import { AddressesManager } from "@/components/account/addresses-manager";

export default async function AccountAddressesPage() {
  const customer = (await getCustomerContext())!;
  const addresses = await getCustomerAddressBook(customer.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Address book</h1>
      <AddressesManager addresses={addresses} />
    </div>
  );
}
