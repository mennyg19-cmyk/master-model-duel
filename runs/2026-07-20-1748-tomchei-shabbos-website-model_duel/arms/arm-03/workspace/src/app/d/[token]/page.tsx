import { DriverMagicClient } from "./driver-client";

export default async function MagicDriverPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <DriverMagicClient token={token} />;
}
