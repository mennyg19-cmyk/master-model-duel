import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { oneLineAddress } from "@/lib/routes/geo";
import { BRAND } from "@/lib/brand";

// R-077/R-076 + G-030 printed fallback: the route manifest (driver works the
// run from paper when the phone dies) and the per-route greeting cards
// (UR-013), both rendered on demand from the route's stops — a reprint never
// touches what was already packed. Shares lib/print/pdf.ts discipline:
// WinAnsi-safe text, uncompressed object streams so smoke can grep the PDF.

function toPdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

const CARD: [number, number] = [432, 288];
const LETTER: [number, number] = [612, 792];

async function loadRouteForPrint(routeId: string) {
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    include: {
      stops: {
        orderBy: { seq: "asc" },
        include: {
          package: {
            select: {
              greeting: true,
              order: { select: { wireFormat: true } },
              lines: { select: { qty: true, orderLine: { select: { productName: true, optionLabel: true } } } },
            },
          },
        },
      },
    },
  });
  if (!route) throw new NotFoundError("DeliveryRoute", routeId);
  return route;
}

// The manifest: header (route, day, status) then one block per stop — seq,
// recipient, full address, contents. Delivered stops carry their stamp so a
// mid-run reprint doubles as the progress sheet.
export async function renderRouteManifestPdf(routeId: string): Promise<Uint8Array> {
  const route = await loadRouteForPrint(routeId);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 54;
  let page = doc.addPage(LETTER);
  let y = LETTER[1] - margin;
  const line = (text: string, size: number, useBold = false) => {
    if (y < margin) {
      page = doc.addPage(LETTER);
      y = LETTER[1] - margin;
    }
    page.drawText(toPdfSafe(text), { x: margin, y, size, font: useBold ? bold : font });
    y -= size * 1.35;
  };

  line(`${BRAND.orgName} — delivery route`, 16, true);
  line(`${route.name}${route.deliveryDay ? ` · ${route.deliveryDay}` : ""} · ${route.status}`, 12);
  y -= 10;
  for (const stop of route.stops) {
    line(
      `#${stop.seq}  ${stop.recipientName}${stop.deliveredAt ? `  [DELIVERED ${stop.deliveredAt.toISOString().slice(11, 16)}]` : ""}`,
      12,
      true,
    );
    line(
      `   ${oneLineAddress({ line1: stop.addressLine1, line2: stop.addressLine2, city: stop.city, region: stop.region, postalCode: stop.postalCode })}`,
      10,
    );
    for (const pkgLine of stop.package.lines) {
      line(`   ${pkgLine.qty} x ${pkgLine.orderLine.productName}${pkgLine.orderLine.optionLabel ? ` (${pkgLine.orderLine.optionLabel})` : ""}`, 10);
    }
    if (stop.package.greeting) line(`   Greeting card enclosed`, 9);
    y -= 8;
  }
  line(`Route ${route.id} · ${route.stops.length} stop(s)`, 8);
  return doc.save({ useObjectStreams: false });
}

// Per-route greeting cards (UR-013): one 6x4 card-stock page per stop whose
// package carries a greeting; greetingless stops are skipped by design.
export async function renderRouteCardsPdf(routeId: string): Promise<Uint8Array> {
  const route = await loadRouteForPrint(routeId);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let cardCount = 0;
  for (const stop of route.stops) {
    const greeting = stop.package.greeting;
    if (!greeting) continue;
    cardCount += 1;
    const page = doc.addPage(CARD);
    const centered = (text: string, size: number, yPos: number, useBold = false) => {
      const useFont = useBold ? bold : font;
      const width = useFont.widthOfTextAtSize(toPdfSafe(text), size);
      page.drawText(toPdfSafe(text), { x: Math.max(20, (CARD[0] - width) / 2), y: yPos, size, font: useFont });
    };
    centered(greeting, 20, CARD[1] - 80);
    centered(`For ${stop.recipientName}`, 12, CARD[1] - 140, true);
    centered(`Stop #${stop.seq} · ${stop.package.order.wireFormat ?? route.name}`, 8, CARD[1] - 180);
  }
  if (cardCount === 0) {
    const page = doc.addPage(CARD);
    const text = toPdfSafe(`No greeting cards on route ${route.name}`);
    page.drawText(text, { x: Math.max(20, (CARD[0] - font.widthOfTextAtSize(text, 12)) / 2), y: CARD[1] / 2, size: 12, font });
  }
  return doc.save({ useObjectStreams: false });
}
