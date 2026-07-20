import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current-user";
import { Card, CardTitle } from "@/components/ui/card";

export default async function DriverHomePage() {
  const staff = await getStaffContext();
  if (!staff) redirect("/login?next=/driver");

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardTitle>Driver area</CardTitle>
        <p className="text-sm text-muted">
          Hi {staff.actingAs.name}. Delivery routes and magic-link driver access arrive in the
          fulfillment phases. Drivers have no admin access.
        </p>
      </Card>
    </main>
  );
}
