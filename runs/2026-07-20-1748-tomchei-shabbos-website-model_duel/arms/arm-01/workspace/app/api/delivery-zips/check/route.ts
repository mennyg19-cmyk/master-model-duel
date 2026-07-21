import { getSetting } from "@/lib/settings";

/** Reads the delivery-ZIP list fresh every request so admin edits apply immediately (G-014). */
export async function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip") ?? "";
  if (!/^\d{5}$/.test(zip)) {
    return Response.json({ error: "Enter a 5-digit ZIP code." }, { status: 400 });
  }
  const deliveryZips = await getSetting("shipping.delivery_zips");
  return Response.json({ zip, deliverable: deliveryZips.includes(zip) });
}
