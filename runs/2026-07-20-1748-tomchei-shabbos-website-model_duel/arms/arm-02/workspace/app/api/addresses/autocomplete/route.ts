import { getCustomerContext } from "@/lib/auth/customer-session";
import { suggestAddresses } from "@/lib/addresses/autocomplete";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Address autocomplete (R-025). Saved-address suggestions come only from the
// session customer's own book, so the endpoint can't be used to read anyone
// else's addresses.
export async function GET(request: Request) {
  if (!rateLimit(`autocomplete:${clientIp(request)}`, 60, 60_000)) {
    return Response.json({ suggestions: [] }, { status: 429 });
  }
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const customer = await getCustomerContext();
  const suggestions = await suggestAddresses(query.slice(0, 120), customer?.id ?? null);
  return Response.json({ suggestions });
}
