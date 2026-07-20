import { MessageStatus, type PrismaClient } from "@prisma/client";

export async function purgeMessageLogs(
  prisma: PrismaClient,
  cutoff: Date,
  runKey: string,
) {
  const priorRun = await prisma.cronRun.findUnique({ where: { runKey } });
  if (priorRun) return priorRun;
  const run = await prisma.cronRun.create({
    data: { jobName: "message-log-purge", runKey, status: "RUNNING" },
  });
  const [attempts, captures] = await prisma.$transaction([
    prisma.messageAttempt.deleteMany({
      where: {
        attemptedAt: { lt: cutoff },
        outbox: {
          status: { in: [MessageStatus.SENT, MessageStatus.CAPTURED] },
        },
      },
    }),
    prisma.notificationCapture.deleteMany({
      where: { sentAt: { lt: cutoff } },
    }),
  ]);
  return prisma.cronRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      claimed: attempts.count + captures.count,
      succeeded: attempts.count + captures.count,
      finishedAt: new Date(),
    },
  });
}
