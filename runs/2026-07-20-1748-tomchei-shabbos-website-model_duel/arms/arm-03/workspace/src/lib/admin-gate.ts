import { AuthError, getStaffContext, isSetupComplete } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export async function requireAdminPage(permission: Permission = "admin.access") {
  if (!(await isSetupComplete())) {
    redirect("/admin/setup");
  }
  const ctx = await getStaffContext();
  if (!ctx) {
    throw new AuthError(401, "Sign in required");
  }
  if (!ctx.permissions.has(permission)) {
    throw new AuthError(403, `Missing permission: ${permission}`);
  }
  return ctx;
}
