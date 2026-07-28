"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

// Dev-seam sign out: revokes the server-side CustomerSession row and clears
// the cookie. With Clerk wired in, this button calls Clerk's signOut instead.
export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await apiFetch("/api/dev-auth-customer", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      data-sign-out
    >
      Sign out
    </button>
  );
}
