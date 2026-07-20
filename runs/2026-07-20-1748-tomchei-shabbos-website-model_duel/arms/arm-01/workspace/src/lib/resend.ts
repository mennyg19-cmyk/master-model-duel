import { Resend } from "resend";

export type EmailDelivery = {
  idempotencyKey: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
};

let resendClient: Resend | null = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required when email test mode is disabled.");
  }
  resendClient ??= new Resend(apiKey);
  return resendClient;
}

export function isEmailTestMode() {
  return (
    process.env.EMAIL_TEST_MODE === "true" ||
    (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY)
  );
}

export async function sendResendEmail(email: EmailDelivery) {
  if (process.env.RESEND_FORCE_FAILURE === "true") {
    throw new Error("Resend forced failure for P11 smoke verification.");
  }
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  if (!fromAddress) {
    throw new Error("EMAIL_FROM_ADDRESS is required for Resend delivery.");
  }
  const response = await getResendClient().emails.send(
    {
      from: fromAddress,
      to: email.recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    },
    { idempotencyKey: email.idempotencyKey },
  );
  if (response.error) {
    throw new Error(`Resend delivery failed: ${response.error.message}`);
  }
  return response.data?.id ?? null;
}
