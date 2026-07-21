import { requirePermission } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { PosPageClient } from "@/components/admin/pos-page-client";

/** Shared storefront/POS builder + customer lookup + cash/check checkout (P5/P6). */
export default async function AdminPosPage() {
  try {
    await requirePermission("admin.access");
  } catch {
    return <Forbidden message="Admin access required for POS builder." />;
  }

  return <PosPageClient />;
}
