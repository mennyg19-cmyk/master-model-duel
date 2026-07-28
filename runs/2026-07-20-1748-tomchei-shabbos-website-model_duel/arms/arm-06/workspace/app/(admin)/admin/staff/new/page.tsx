import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { Card, CardTitle } from "@/components/ui/card";
import { NewStaffForm } from "./new-staff-form";

export const metadata: Metadata = { title: "Add staff" };
export const dynamic = "force-dynamic";

export default async function NewStaffPage() {
  await requirePermission("staff.manage");

  return (
    <div className="max-w-lg">
      <Card className="p-6">
        <CardTitle>Add staff account</CardTitle>
        <p className="mt-2 text-sm text-stone-600">
          The account starts as pending. Share the invite link it generates; the person
          confirms it to activate and sign in.
        </p>
        <NewStaffForm />
      </Card>
    </div>
  );
}
