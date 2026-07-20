import { MessageChannel, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueMessage } from "@/domain/messaging-outbox";

type MessageClient = PrismaClient | Prisma.TransactionClient;
export type TemplateVariables = Record<string, string | number>;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTemplate(
  source: string,
  variables: TemplateVariables,
  transform: (value: string) => string = (value) => value,
) {
  return source.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) =>
    transform(String(variables[key] ?? "")),
  );
}

export function brandedHtml(content: string) {
  return `<div style="font-family:Arial,sans-serif;color:#17231d"><div style="border-bottom:4px solid #7a2434;padding:16px 0;font-size:20px;font-weight:700">Tomchei Shabbos</div><main style="padding:24px 0">${content}</main><footer style="border-top:1px solid #ddd;padding-top:16px;color:#66736c">Purim gifts that support local families.</footer></div>`;
}

export async function enqueueTransactionalEmail(
  prisma: MessageClient,
  input: {
    idempotencyKey: string;
    templateKey: string;
    recipient: string | null;
    variables: TemplateVariables;
    customerId?: string;
    orderId?: string;
    packageId?: string;
  },
) {
  const template = await prisma.emailTemplate.findUniqueOrThrow({
    where: { key: input.templateKey },
  });
  if (!template.isEnabled) return null;

  return enqueueMessage(prisma, {
    idempotencyKey: input.idempotencyKey,
    templateKey: input.templateKey,
    recipient: input.recipient,
    customerId: input.customerId,
    orderId: input.orderId,
    packageId: input.packageId,
    channel: MessageChannel.EMAIL,
    eventKey: input.idempotencyKey,
    subject: renderTemplate(template.subject, input.variables),
    htmlBody: brandedHtml(
      renderTemplate(template.htmlBody, input.variables, escapeHtml),
    ),
    textBody: renderTemplate(template.textBody, input.variables),
    payload: input.variables,
  });
}
