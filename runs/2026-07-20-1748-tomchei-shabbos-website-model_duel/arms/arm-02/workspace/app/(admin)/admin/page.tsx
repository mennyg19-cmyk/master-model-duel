import { db } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/current-user";
import { Card, CardTitle } from "@/components/ui/card";

export default async function AdminDashboardPage() {
  const staff = await getStaffContext();
  const [staffCount, customerCount, auditCount] = await Promise.all([
    db.staffUser.count(),
    db.customer.count(),
    db.auditLog.count(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Dashboard</h1>
      <p className="text-sm text-muted mb-6">
        Signed in as {staff?.actingAs.name} ({staff?.actingAs.role}).
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle className="text-sm text-muted mb-1">Staff accounts</CardTitle>
          <p className="text-3xl font-bold">{staffCount}</p>
        </Card>
        <Card>
          <CardTitle className="text-sm text-muted mb-1">Customers</CardTitle>
          <p className="text-3xl font-bold">{customerCount}</p>
        </Card>
        <Card>
          <CardTitle className="text-sm text-muted mb-1">Audit entries</CardTitle>
          <p className="text-3xl font-bold">{auditCount}</p>
        </Card>
      </div>
    </div>
  );
}
