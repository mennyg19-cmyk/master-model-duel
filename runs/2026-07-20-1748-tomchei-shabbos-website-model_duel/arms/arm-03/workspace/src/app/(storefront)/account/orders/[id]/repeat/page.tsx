import { RepeatReviewClient } from "@/components/account/repeat-review";

type Props = { params: Promise<{ id: string }> };

export default async function RepeatReviewPage({ params }: Props) {
  const { id } = await params;
  return <RepeatReviewClient orderId={id} />;
}
