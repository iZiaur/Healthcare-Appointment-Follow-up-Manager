import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, JobStatus, JobType } from "@prisma/client";
import { JobWorker } from "../jobs/worker";
import { JobQueue } from "../jobs/queue";
import { StubEmailProvider } from "../lib/email/stub-provider";
import { SummaryService } from "../lib/llm/summary-service";
import { StubProvider } from "../lib/llm/stub-provider";
import { isAfter } from "date-fns";

const prisma = new PrismaClient();
const emailProvider = new StubEmailProvider();
const llmProvider = new StubProvider();
const summaryService = new SummaryService(llmProvider);
const worker = new JobWorker(prisma, emailProvider, summaryService);
const queue = new JobQueue(prisma);

describe("Background Job Worker (Email & LLM)", () => {
  let jobIdSuccess: string;
  let jobIdFail: string;

  beforeAll(async () => {
    // Clean up existing jobs
    await prisma.backgroundJob.deleteMany();

    // Enqueue a job that will succeed
    const job1 = await queue.enqueue(JobType.EMAIL, {
      to: "success@test.com",
      subject: "Test",
      html: "<p>Success</p>"
    });
    jobIdSuccess = job1.id;

    // Enqueue a job that will fail repeatedly
    const job2 = await queue.enqueue(JobType.EMAIL, {
      to: "fail@test.com",
      subject: "Test",
      html: "<p>Fail</p>"
    });
    jobIdFail = job2.id;
  });

  afterAll(async () => {
    await prisma.backgroundJob.deleteMany();
    await prisma.$disconnect();
  });

  it("should process jobs successfully", async () => {
    emailProvider.forceFailure = false;
    
    const count = await worker.processJobs();
    expect(count).toBeGreaterThan(0);

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobIdSuccess } });
    expect(job?.status).toBe(JobStatus.COMPLETED);
    expect(job?.attempts).toBe(0);
  });

  it("should increment attempts and apply backoff on failure", async () => {
    emailProvider.forceFailure = true;

    // Reset the fail job back to pending if it was picked up in previous test
    await prisma.backgroundJob.update({
      where: { id: jobIdFail },
      data: { status: JobStatus.PENDING, nextRetryAt: new Date() }
    });

    const runAtStart = new Date();
    await worker.processJobs();

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobIdFail } });
    
    expect(job?.status).toBe(JobStatus.PENDING);
    expect(job?.attempts).toBe(1);
    
    // Backoff should push it roughly 5 minutes into the future
    expect(isAfter(job!.nextRetryAt, runAtStart)).toBe(true);
    expect(job?.errorLog).toContain("StubEmailProvider forced failure");
  });

  it("should mark job as FAILED after max attempts", async () => {
    emailProvider.forceFailure = true;

    // Force attempts to max-1 and make it ready to process now
    await prisma.backgroundJob.update({
      where: { id: jobIdFail },
      data: { attempts: 2, nextRetryAt: new Date(Date.now() - 1000) }
    });

    await worker.processJobs();

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobIdFail } });
    
    expect(job?.status).toBe(JobStatus.FAILED);
    expect(job?.attempts).toBe(3); // Maxed out
  });
});
