import type { Prisma, PrismaClient } from "@prisma/client";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export async function getLaunchReports(db: DatabaseClient) {
  const [seasons, labels] = await Promise.all([
    db.season.findMany({
      orderBy: { year: "desc" },
      select: {
        id: true,
        name: true,
        year: true,
        orders: {
          where: { status: "FINALIZED" },
          select: {
            totalCents: true,
            donationCents: true,
            customerId: true,
            lines: {
              select: {
                skuSnapshot: true,
                productNameSnapshot: true,
                quantity: true,
                unitPriceCentsSnapshot: true,
              },
            },
            packages: {
              where: { isActive: true },
              select: {
                fulfillmentMethod: { select: { code: true } },
              },
            },
          },
        },
      },
    }),
    db.shippingLabel.findMany({
      where: { status: "PURCHASED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        packageId: true,
        chargedCents: true,
        purchasedCents: true,
        marginCents: true,
        provider: true,
        serviceCode: true,
        package: {
          select: {
            recipientName: true,
            order: {
              select: {
                orderNumber: true,
                season: { select: { id: true, name: true, year: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const seasonReports = seasons.map((season) => {
    const fulfillmentCounts = new Map<string, number>();
    const itemSales = new Map<
      string,
      { sku: string; name: string; quantity: number; revenueCents: number }
    >();
    for (const order of season.orders) {
      for (const orderPackage of order.packages) {
        const code = orderPackage.fulfillmentMethod.code;
        fulfillmentCounts.set(code, (fulfillmentCounts.get(code) ?? 0) + 1);
      }
      for (const line of order.lines) {
        const sale = itemSales.get(line.skuSnapshot) ?? {
          sku: line.skuSnapshot,
          name: line.productNameSnapshot,
          quantity: 0,
          revenueCents: 0,
        };
        sale.quantity += line.quantity;
        sale.revenueCents += line.quantity * line.unitPriceCentsSnapshot;
        itemSales.set(line.skuSnapshot, sale);
      }
    }
    return {
      seasonId: season.id,
      seasonName: season.name,
      year: season.year,
      orderCount: season.orders.length,
      customerCount: new Set(season.orders.map((order) => order.customerId)).size,
      revenueCents: season.orders.reduce((sum, order) => sum + order.totalCents, 0),
      donationCents: season.orders.reduce(
        (sum, order) => sum + order.donationCents,
        0,
      ),
      fulfillment: [...fulfillmentCounts.entries()]
        .map(([code, packageCount]) => ({ code, packageCount }))
        .sort((left, right) => left.code.localeCompare(right.code)),
      itemSales: [...itemSales.values()].sort(
        (left, right) => right.revenueCents - left.revenueCents,
      ),
    };
  });

  const marginBySeason = new Map<
    string,
    {
      seasonId: string;
      seasonName: string;
      year: number;
      chargedCents: number;
      purchasedCents: number;
      marginCents: number;
      packageCount: number;
    }
  >();
  for (const label of labels) {
    const season = label.package.order.season;
    const report = marginBySeason.get(season.id) ?? {
      seasonId: season.id,
      seasonName: season.name,
      year: season.year,
      chargedCents: 0,
      purchasedCents: 0,
      marginCents: 0,
      packageCount: 0,
    };
    report.chargedCents += label.chargedCents;
    report.purchasedCents += label.purchasedCents;
    report.marginCents += label.marginCents;
    report.packageCount += 1;
    marginBySeason.set(season.id, report);
  }

  return {
    seasons: seasonReports,
    shippingMargin: {
      totals: [...marginBySeason.values()].sort(
        (left, right) => right.year - left.year,
      ),
      packages: labels.map((label) => ({
        labelId: label.id,
        packageId: label.packageId,
        season: label.package.order.season.name,
        orderNumber: label.package.order.orderNumber,
        recipientName: label.package.recipientName,
        provider: label.provider,
        serviceCode: label.serviceCode,
        chargedCents: label.chargedCents,
        purchasedCents: label.purchasedCents,
        marginCents: label.marginCents,
      })),
    },
  };
}
