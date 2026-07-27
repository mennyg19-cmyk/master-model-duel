import { adminHandler } from "@/lib/api/admin-handler";
import { renderDoorList } from "@/lib/pickup";

/** Printable door list of ready pickups with a picked-up stamp box (G-026). */
export const GET = adminHandler({}, async ({ season }) => {
  const pdf = await renderDoorList(season.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="pickup-door-list.pdf"',
    },
  });
});
