import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, JobStatus, JobType } from "@prisma/client";
import { JobWorker } from "../../jobs/worker";
import { EmailProvider } from "../../lib/email/provider";
import { SummaryService } from "../../lib/llm/summary-service";

const prisma = new PrismaClient();

// Mock EmailProvider (stub)
const emailProvider = {
  send: async () => {}
} as unknown as EmailProvider;

// Mock SummaryService to always fail
const failingSummaryService = {
  generatePostVisitSummary: async () => {
    throw new Error("LLM API quota exceeded");
  }
} as unknown as SummaryService;

describe("LLM Failure Fallback", () => {
  let worker: JobWorker;

  beforeEach(async () => {
    await prisma.backgroundJob.deleteMany({});
    
    // Create worker with failing LLM
    worker = new JobWorker(prisma, emailProvider, failingSummaryService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should fail gracefully after 3 attempts on LLM error", async () => {
    // 1. Queue an LLM job
    const job = await prisma.backgroundJob.create({
      data: {
        type: JobType.LLM_RETRY,
        status: JobStatus.PENDING,
        attempts: 0,
        maxAttempts: 3,
        payload: { appointmentId: "test-id" }
      }
    });

    // Attempt 1
    let res = await worker.processJobs();
    expect(res.failed).toBe(1);

    let updatedJob = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe(JobStatus.PENDING);
    expect(updatedJob?.attempts).toBe(1);

    // Override nextRetryAt to simulate time passing
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) }
    });

    // Attempt 2
    res = await worker.processJobs();
    expect(res.failed).toBe(1);
    
    updatedJob = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.attempts).toBe(2);

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
    expect(updatedJob?.errorLog).toContain("LLM API quota exceeded");
  });
});
