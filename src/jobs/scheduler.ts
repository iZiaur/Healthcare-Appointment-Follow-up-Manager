import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { HoldCleanupService } from "./hold-cleanup";
import { CronService } from "./cron";
import { JobWorker } from "./worker";
import { JobQueue } from "./queue";
import { NodemailerProvider } from "../lib/email/nodemailer-provider";
import { StubEmailProvider } from "../lib/email/stub-provider";
import { SummaryService } from "../lib/llm/summary-service";
import { GoogleCalendarService } from "../lib/calendar/google-calendar";
import { StubProvider as StubLLMProvider } from "../lib/llm/stub-provider";
// Assuming you have a real one or using stub for now
// import { GeminiProvider } from "../lib/llm/gemini-provider";

const prisma = new PrismaClient();

// Setup Dependencies
const emailProvider = process.env.EMAIL_PROVIDER === "nodemailer" 
  ? new NodemailerProvider() 
  : new StubEmailProvider();

const llmProvider = new StubLLMProvider(); // Or conditionally use GeminiProvider
const summaryService = new SummaryService(llmProvider);
const calendarService = new GoogleCalendarService(prisma);
const queue = new JobQueue(prisma);

// Setup Services
const worker = new JobWorker(prisma, emailProvider, summaryService, calendarService);
const cronService = new CronService(prisma, queue);
const holdCleanupService = new HoldCleanupService(prisma);

console.log("===================================================");
console.log("🚀 Healthcare Background Job Scheduler Started");
console.log("===================================================");

// 1. Expired Hold Release (Runs every minute)
cron.schedule("* * * * *", async () => {
  try {
    const released = await holdCleanupService.releaseExpiredHolds();
    if (released > 0) {
      console.log(`[Scheduler] Hold Cleanup: Released ${released} expired slot holds.`);
    }
  } catch (error: any) {
    console.error(`[Scheduler] Hold Cleanup Failed: ${error.message}`);
  }
});

// 2. Email / Calendar Sync / LLM Retry Queue (Runs every minute)
cron.schedule("* * * * *", async () => {
  try {
    const { processed, failed } = await worker.processJobs();
    if (processed > 0 || failed > 0) {
      console.log(`[Scheduler] Queue Worker: Processed ${processed} jobs. (${processed} Succeeded, ${failed} Failed)`);
    }
  } catch (error: any) {
    console.error(`[Scheduler] Queue Worker Failed: ${error.message}`);
  }
});

// 3. Appointment & Medication Reminders (Runs every 15 minutes, e.g. 08:00, 08:15)
cron.schedule("*/15 * * * *", async () => {
  try {
    // Check Appointment Reminders (24h in advance)
    const apptResult = await cronService.checkAppointmentReminders();
    if (apptResult.processed > 0 || apptResult.failed > 0) {
      console.log(`[Scheduler] Appointment Reminders: (${apptResult.processed} Succeeded, ${apptResult.failed} Failed)`);
    }
    
    // Check Medication Reminders (Scheduled for this specific 15m window)
    const medResult = await cronService.checkMedicationReminders();
    if (medResult.processed > 0 || medResult.failed > 0) {
      console.log(`[Scheduler] Medication Reminders: (${medResult.processed} Succeeded, ${medResult.failed} Failed)`);
    }
    
  } catch (error: any) {
    console.error(`[Scheduler] Reminders Cron Failed: ${error.message}`);
  }
});

console.log("Registered Cron Jobs:");
console.log(" - [* * * * *] Hold Cleanup & Background Queue Worker (1m)");
console.log(" - [*/15 * * * *] Appointment & Medication Reminders (15m)");
