import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { autocompleteAddresses } from "@/lib/address/geocode";
import { validateAddressInput } from "@/lib/address/normalize";
import { geocodeAddress } from "@/lib/address/geocode";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const suggestions = autocompleteAddresses(q);
    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const validateSchema = z.object({
  recipientName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  postalCode: z.string().min(5),
  country: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const body = validateSchema.parse(await request.json());
    const message = validateAddressInput(body);
    if (message) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    const geo = await geocodeAddress(body);
    return NextResponse.json({
      ok: true,
      valid: true,
      geocode: geo,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
