export async function sendSmsMessage(input: {
  idempotencyKey: string;
  recipient: string;
  text: string;
}) {
  const endpoint = process.env.SMS_PROVIDER_URL;
  const token = process.env.SMS_PROVIDER_TOKEN;
  if (!endpoint || !token) {
    throw new Error(
      "SMS_PROVIDER_URL and SMS_PROVIDER_TOKEN are required when message test mode is disabled.",
    );
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({ to: input.recipient, text: input.text }),
  });
  if (!response.ok) {
    throw new Error(`SMS provider returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as { id?: string };
  return payload.id ?? null;
}
