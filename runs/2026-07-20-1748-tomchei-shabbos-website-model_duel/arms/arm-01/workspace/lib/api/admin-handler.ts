import type { z } from "zod";
import { requirePermissionApi, type StaffContext } from "@/lib/auth/current-user";
import type { Permission } from "@/lib/auth/permissions";
import { ActionError } from "@/lib/packages/actions";
import { getOpenSeason } from "@/lib/season";

// Shared admin route-handler plumbing: permission gate → open-season 409 →
// body parse 400 → ActionError mapping. Every admin POST/PATCH/GET repeated
// this verbatim; handlers now declare only what varies.

type OpenSeason = NonNullable<Awaited<ReturnType<typeof getOpenSeason>>>;

export type AdminHandlerContext<P, B> = {
  request: Request;
  params: P;
  staff: StaffContext;
  season: OpenSeason;
  body: B;
};

type AdminHandlerConfig<B> = {
  /** Defaults to fulfillment.manage — the P9 surface's gate. */
  permission?: Permission;
  /** When set, the JSON body is parsed and validated before the handler runs. */
  schema?: z.ZodType<B>;
  /** Fallback body when the request carries no/invalid JSON (e.g. {} for all-optional schemas). */
  emptyBody?: unknown;
  /** Fixed 400 message; defaults to the first zod issue. */
  invalidMessage?: string;
};

export function adminHandler<P = Record<string, never>, B = undefined>(
  config: AdminHandlerConfig<B>,
  run: (context: AdminHandlerContext<P, B>) => Promise<Response>
) {
  return async (request: Request, routeContext?: { params: Promise<P> }): Promise<Response> => {
    const gate = await requirePermissionApi(config.permission ?? "fulfillment.manage");
    if ("response" in gate) return gate.response;

    const season = await getOpenSeason();
    if (!season) return Response.json({ error: "No open season" }, { status: 409 });

    const params = routeContext ? await routeContext.params : ({} as P);

    let body = undefined as B;
    if (config.schema) {
      const raw = await request.json().catch(() => config.emptyBody ?? null);
      const parsed = config.schema.safeParse(raw);
      if (!parsed.success) {
        return Response.json(
          { error: config.invalidMessage ?? parsed.error.issues[0].message },
          { status: 400 }
        );
      }
      body = parsed.data;
    }

    try {
      return await run({ request, params, staff: gate.staff, season, body });
    } catch (error) {
      if (error instanceof ActionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  };
}
