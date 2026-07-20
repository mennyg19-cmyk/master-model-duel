import type { Prisma, PrismaClient } from "@prisma/client";

type MessageClient = PrismaClient | Prisma.TransactionClient;

export const defaultEmailLists = [
  { key: "product-updates", name: "Product updates", preferenceField: "productUpdates" },
  { key: "volunteer-stories", name: "Volunteer stories", preferenceField: "volunteerStories" },
  { key: "community-impact", name: "Community impact", preferenceField: "communityImpact" },
] as const;

const defaultTemplates = [
  {
    key: "newsletter.preferences",
    name: "Newsletter preferences",
    subject: "Manage your Tomchei Shabbos updates",
    htmlBody: "<p>Thanks for subscribing. <a href=\"{{preferenceUrl}}\">Choose which updates you receive</a>.</p>",
    textBody: "Thanks for subscribing. Manage your updates: {{preferenceUrl}}",
  },
  {
    key: "order.confirmation",
    name: "Order confirmation",
    subject: "Order {{orderNumber}} confirmed",
    htmlBody: "<p>Thank you, {{customerName}}. Your order {{orderNumber}} is confirmed.</p>",
    textBody: "Thank you, {{customerName}}. Your order {{orderNumber}} is confirmed.",
  },
  {
    key: "order.payment_link",
    name: "Payment link",
    subject: "Payment reminder for order {{orderNumber}}",
    htmlBody: "<p>Your order {{orderNumber}} still needs payment. <a href=\"{{paymentUrl}}\">Pay securely</a>.</p>",
    textBody: "Your order {{orderNumber}} still needs payment: {{paymentUrl}}",
  },
  {
    key: "order.refund",
    name: "Refund",
    subject: "Refund recorded for order {{orderNumber}}",
    htmlBody: "<p>We recorded a refund of {{refundAmount}} for order {{orderNumber}}.</p>",
    textBody: "We recorded a refund of {{refundAmount}} for order {{orderNumber}}.",
  },
  {
    key: "delivery.day_of",
    name: "Delivery today",
    subject: "Your Purim package is out for delivery",
    htmlBody: "<p>Your package for {{recipientName}} is out for delivery today.</p>",
    textBody: "Your package for {{recipientName}} is out for delivery today.",
  },
  {
    key: "pickup.ready",
    name: "Pickup ready",
    subject: "Your Purim package is ready for pickup",
    htmlBody: "<p>Your package is ready at {{pickupLocation}}.</p>",
    textBody: "Your package is ready at {{pickupLocation}}.",
  },
  {
    key: "delivery.bulk",
    name: "Bulk delivery scheduled",
    subject: "Your delivery is scheduled",
    htmlBody: "<p>Your delivery window is {{deliveryWindow}}.</p>",
    textBody: "Your delivery window is {{deliveryWindow}}.",
  },
] as const;

export async function ensureMessagingConfiguration(prisma: MessageClient) {
  await Promise.all(
    defaultEmailLists.map((list) =>
      prisma.emailList.upsert({
        where: { key: list.key },
        create: list,
        update: { name: list.name, preferenceField: list.preferenceField },
      }),
    ),
  );
  await Promise.all(
    defaultTemplates.map((template) =>
      prisma.emailTemplate.upsert({
        where: { key: template.key },
        create: template,
        update: {},
      }),
    ),
  );
}
