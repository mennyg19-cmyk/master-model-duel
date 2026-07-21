import { z } from "zod";
import { adminHandler } from "@/lib/api/admin-handler";
import { switchPackageMethod } from "@/lib/routes/service";

const schema = z.object({ methodId: z.string().min(1) });

/**
 * Method switch shipping <-> delivery (UR-002, G-005). The customer's charge
 * is preserved — no money moves; the switch is fully audited.
 */
export const POST = adminHandler<{ id: string }, z.infer<typeof schema>>(
  { schema, invalidMessage: "Pick a method" },
  async ({ params, staff, season, body }) => {
    const { from, to } = await switchPackageMethod(season.id, params.id, body.methodId, {
      id: staff.realUser.id,
      email: staff.realUser.email,
    });
    return Response.json({ ok: true, from: from.name, to: to.name });
  }
);
