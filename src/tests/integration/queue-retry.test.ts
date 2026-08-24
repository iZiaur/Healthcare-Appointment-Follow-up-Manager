import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, JobStatus, JobType } from "@prisma/client";
import { JobWorker } from "../../jobs/worker";
import { SummaryService } from "../../lib/llm/summary-service";

const prisma = new PrismaClient();

// Mock SummaryService (stub)
const summaryService = {
  generatePostVisitSummary: async () => ({ status: "COMPLETED" })
} as unknown as SummaryService;

// Mock EmailProvider to always fail
const failingEmailProvider = {
  send: async () => {
    throw new Error("SMTP connection timeout");
  }
} as any;

describe("Email Queue Retry & Backoff", () => {
  let worker: JobWorker;

  beforeEach(async () => {
    await prisma.backgroundJob.deleteMany({});
    
    // Create worker with failing email provider
    worker = new JobWorker(prisma, failingEmailProvider, summaryService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should retry email sending and apply exponential backoff", async () => {
    // 1. Queue an Email job
    const job = await prisma.backgroundJob.create({
      data: {
        type: JobType.EMAIL,
        status: JobStatus.PENDING,
        attempts: 0,
        maxAttempts: 3,
        payload: { to: "test@example.com", subject: "Test", html: "<p>Test</p>" }
      }
    });

    const now = Date.now();

    // Attempt 1
    let res = await worker.processJobs();
    expect(res.failed).toBe(1);

    let updatedJob = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.attempts).toBe(1);
    
    // First backoff is 5 minutes
    const timeDiff1 = updatedJob!.nextRetryAt!.getTime() - now;
    expect(timeDiff1).toBeGreaterThanOrEqual(4 * 60 * 1000); 
    expect(timeDiff1).toBeLessThanOrEqual(6 * 60 * 1000);

    // Override nextRetryAt to simulate time passing
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) }
    });

    const now2 = Date.now();

    // Attempt 2
    res = await worker.processJobs();
    expect(res.failed).toBe(1);
    
    updatedJob = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.attempts).toBe(2);

    // Second backoff is 10 minutes
    const timeDiff2 = updatedJob!.nextRetryAt!.getTime() - now2;
    expect(timeDiff2).toBeGreaterThanOrEqual(9 * 60 * 1000);
    expect(timeDiff2).toBeLessThanOrEqual(11 * 60 * 1000);

    // Override nextRetryAt again
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) }
    });

    // Attempt 3 (Final)
    res = await worker.processJobs();
    expect(res.failed).toBe(1);
    
    updatedJob = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe(JobStatus.FAILED);
    expect(updatedJob?.attempts).toBe(3);
    expect(updatedJob?.errorLog).toContain("SMTP connection timeout");
  });
});
