import { PrismaClient, JobStatus, JobType, BackgroundJob, UserRole } from "@prisma/client";
import { EmailProvider } from "../lib/email/provider";
import { SummaryService } from "../lib/llm/summary-service";
import { GoogleCalendarService } from "../lib/calendar/google-calendar";
import { addMinutes } from "date-fns";

export class JobWorker {
  constructor(
    private prisma: PrismaClient,
    private emailProvider: EmailProvider,
    private summaryService: SummaryService,
    private calendarService?: GoogleCalendarService
  ) {}

  /**
   * Processes all pending jobs whose nextRetryAt is in the past.
   * Claims jobs atomically to prevent race conditions during horizontal scaling.
   */
  async processJobs(): Promise<{ processed: number, failed: number }> {
    // 1. Atomically claim up to 50 jobs
    const claimedJobs = await this.prisma.$queryRaw<BackgroundJob[]>`
      UPDATE "background_jobs"
      SET "status" = ${JobStatus.PROCESSING}::"JobStatus"
      WHERE "id" IN (
        SELECT "id" FROM "background_jobs"
        WHERE "status" = ${JobStatus.PENDING}::"JobStatus"
          AND "nextRetryAt" <= NOW()
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    if (claimedJobs.length === 0) return { processed: 0, failed: 0 };

    let processedCount = 0;
    let failedCount = 0;

    for (const job of claimedJobs) {

      try {
        await this.executeJob(job);
        
        // Success -> Mark COMPLETED
        await this.prisma.backgroundJob.update({
          where: { id: job.id },
          data: { status: JobStatus.COMPLETED }
        });
        processedCount++;
      } catch (error: any) {
        failedCount++;
        
        // Check if the error is a graceful failure signal from calendar
        if (error.message === 'GRACEFUL_FAILURE_DO_NOT_RETRY') {
          processedCount++;
          failedCount--; // Adjust, as it's treated as completed for queue purposes
          continue;
        }

        // Failure -> Increment attempts, apply backoff or fail
        const newAttempts = job.attempts + 1;
        
        if (newAttempts >= job.maxAttempts) {
          // Permanently FAILED
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.FAILED,
              attempts: newAttempts,
              errorLog: error.message
            }
          });
          console.error(`[Worker] Job ${job.id} FAILED permanently: ${error.message}`);
        } else {
          // Exponential backoff: 5 minutes, then 10 minutes
          const backoffMinutes = newAttempts === 1 ? 5 : 10;
          
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.PENDING, // Back to pending
              attempts: newAttempts,
              nextRetryAt: addMinutes(new Date(), backoffMinutes),
              errorLog: error.message
            }
          });
          console.warn(`[Worker] Job ${job.id} failed (attempt ${newAttempts}). Retrying in ${backoffMinutes}m.`);
        }
      }
    }

    return { processed: processedCount, failed: failedCount };
  }

  private async executeJob(job: BackgroundJob) {
    const payload = job.payload as any;

    if (job.type === JobType.EMAIL) {
      await this.emailProvider.send(payload.to, payload.subject, payload.html);
    } 
    else if (job.type === JobType.LLM_RETRY) {
      const appointmentId = payload.appointmentId;
      
      // Fetch the visit note
      const visitNote = await this.prisma.visitNote.findUnique({
        where: { appointmentId }
      });

      if (!visitNote || !visitNote.notes) {
        throw new Error("Visit note not found or empty");
      }

      // Retry the post-visit LLM summary
      const summaryResult = await this.summaryService.generatePostVisitSummary(visitNote.notes);

      if (summaryResult.status === "PENDING_REVIEW") {
        throw new Error("LLM generation failed again: " + summaryResult.rawOutput);
      }

      // Update the summary in the DB if successful
      await this.prisma.postVisitSummary.upsert({
        where: { appointmentId },
        update: {
          patientFriendlyText: summaryResult.patientFriendlyText,
          status: "COMPLETED",
          rawOutput: summaryResult.rawOutput
        },
        create: {
          appointmentId,
          patientFriendlyText: summaryResult.patientFriendlyText,
          status: "COMPLETED",
          rawOutput: summaryResult.rawOutput
        }
      });
    }
    else if (job.type === JobType.CALENDAR_SYNC) {
      if (!this.calendarService) return;

      const { userId, appointmentId, action, role } = payload as {
        userId: string;
        appointmentId: string;
        action: 'CREATE' | 'UPDATE' | 'DELETE';
        role: UserRole;
      };

      try {
        if (action === 'DELETE') {
          // For delete, we need the existing event ID
          const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
          const eventId = role === UserRole.DOCTOR ? appt?.doctorGoogleEventId : appt?.patientGoogleEventId;
          
          if (eventId) {
            await this.calendarService.deleteEvent(userId, eventId);
          }
        } 
        else {
          // Fetch full appointment details for CREATE/UPDATE
          const appt = await this.prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
              patient: { include: { user: true } },
              doctor: { include: { user: true } }
            }
          });

          if (!appt) throw new Error("Appointment not found for Calendar Sync");

          const eventInput = {
            title: `Appointment with ${role === UserRole.DOCTOR ? appt.patient.user.name : appt.doctor.user.name}`,
            description: appt.reason || 'No specific reason provided.',
            startTime: appt.slotStartTime,
            endTime: appt.slotEndTime
          };

          if (action === 'CREATE') {
            const eventId = await this.calendarService.createEvent(userId, eventInput);
            
            // Save the newly created eventId back to the Appointment
            await this.prisma.appointment.update({
              where: { id: appointmentId },
              data: role === UserRole.DOCTOR 
                ? { doctorGoogleEventId: eventId } 
                : { patientGoogleEventId: eventId }
            });
          } 
          else if (action === 'UPDATE') {
            const eventId = role === UserRole.DOCTOR ? appt.doctorGoogleEventId : appt.patientGoogleEventId;
            if (eventId) {
              await this.calendarService.updateEvent(userId, eventId, eventInput);
            }
          }
        }
      } catch (err: any) {
        // Graceful degradation: Check if the user revoked access (invalid_grant or 401)
        const isAuthError = err.message?.includes('invalid_grant') || err.status === 401;
        
        if (isAuthError) {
          console.warn(`[Worker] Calendar access revoked for user ${userId}. Cleaning up integration and stopping retries.`);
          // Drop the integration
          await this.prisma.googleIntegration.delete({ where: { userId } }).catch(() => {});
          
          throw new Error('GRACEFUL_FAILURE_DO_NOT_RETRY');
        }

        // If it's a standard network error, re-throw so the worker applies exponential backoff.
        throw err;
      }
    }
  }
}
