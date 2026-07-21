import Link from "next/link";
import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { RepeatReviewClient } from "@/components/account/repeat-review";

type Props = { params: Promise<{ id: string }> };

export default async function StaffRepeatReviewPage({ params }: Props) {
  try {
    await requireAdminPage("admin.access");
    const { id } = await params;
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm">
          <Link href={`/admin/orders/${id}`} className="underline">
            ← Back to order
          </Link>
        </p>
        <h1 className="text-xl font-semibold text-[var(--color-forest)]">
          Repeat order — review
        </h1>
        <RepeatReviewClient orderId={id} audience="staff" />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
