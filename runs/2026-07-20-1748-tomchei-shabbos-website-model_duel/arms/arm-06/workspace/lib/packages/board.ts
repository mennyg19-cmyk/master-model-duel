import { FulfillmentChoice, PackageStage, Prisma } from "@prisma/client";
import { first, parsePageSize } from "@/lib/admin/order-list";

// UR-001: the staff package board. Same URL-driven list discipline as the
// order list (R-052/R-105): filters survive pagination, queries stay
// take/skip bounded for the 5k-package crunch (G-024).
export interface PackageBoardParams {
  q: string | null;
  stage: PackageStage | null;
  channel: FulfillmentChoice | null;
  page: number;
  pageSize: number;
}

type RawParams = Record<string, string | string[] | undefined>;

export function parsePackageBoardParams(searchParams: RawParams): PackageBoardParams {
  const stageRaw = first(searchParams.stage);
  const channelRaw = first(searchParams.channel);
  return {
    q: first(searchParams.q),
    stage: stageRaw && stageRaw in PackageStage ? (stageRaw as PackageStage) : null,
    channel: channelRaw && channelRaw in FulfillmentChoice ? (channelRaw as FulfillmentChoice) : null,
    page: Math.max(1, Number(first(searchParams.page)) || 1),
    pageSize: parsePageSize(searchParams.size),
  };
}

// Search hits recipient name, the order's wire format, or the greeting.
export function buildPackageWhere(seasonId: string, params: PackageBoardParams): Prisma.PackageWhereInput {
  const where: Prisma.PackageWhereInput = { order: { seasonId } };
  if (params.stage) where.stage = params.stage;
  if (params.channel) where.channel = params.channel;
  if (params.q) {
    where.OR = [
      { recipientName: { contains: params.q, mode: "insensitive" } },
      { greeting: { contains: params.q, mode: "insensitive" } },
      { order: { wireFormat: { contains: params.q, mode: "insensitive" } } },
    ];
  }
  return where;
}
