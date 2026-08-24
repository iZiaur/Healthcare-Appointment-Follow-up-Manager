import { PrismaClient, JobType } from "@prisma/client";

export class JobQueue {
  constructor(private prisma: PrismaClient) {}

  /**
   * Enqueues a background job for reliable execution.
   */
  async enqueue(type: JobType, payload: Record<string, any>, runAt?: Date) {
    return this.prisma.backgroundJob.create({
      data: {
        type,
        payload,
        nextRetryAt: runAt || new Date(),
        // Hardcode maxAttempts based on JobType context.
        // Both EMAIL and LLM_RETRY are async background jobs, so 3 attempts is standard.
        // NOTE: The inline LLM call inside Booking/PostVisit services does NOT use this queue
        // and remains 1 immediate retry within the 5s timeout.
        maxAttempts: 3
      }
    });
  }
}
