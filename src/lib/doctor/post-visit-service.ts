import { PrismaClient, AppointmentStatus, ReminderFrequency, JobType } from "@prisma/client";
import { SummaryService } from "../llm/summary-service";
import { JobQueue } from "../../jobs/queue";
import { addDays, setHours, setMinutes, setSeconds, startOfTomorrow } from "date-fns";

export const DEFAULT_REMINDER_START_HOUR = 8; // 8:00 AM

export interface MedicationInput {
  name: string;
  dosage: string;
  frequency: ReminderFrequency;
  durationDays: number;
  instructions?: string;
}

export class PostVisitService {
  constructor(
    private prisma: PrismaClient,
    private summaryService?: SummaryService,
    private queue?: JobQueue
  ) {}

  /**
   * Deterministically calculates medication reminder timestamps based strictly 
   * on the structured prescription enum. It never parses LLM text to derive safety-critical timings.
   */
  public calculateReminderSchedule(frequency: ReminderFrequency, durationDays: number): {
    startDate: Date;
    endDate: Date;
    times: string[];
  } {
    // Start tomorrow morning at the default anchor time
    let startDate = startOfTomorrow();
    startDate = setHours(startDate, DEFAULT_REMINDER_START_HOUR);
    startDate = setMinutes(startDate, 0);
    startDate = setSeconds(startDate, 0);

    const endDate = addDays(startDate, Math.max(durationDays - 1, 0));

    let times: string[] = [];
    switch (frequency) {
      case ReminderFrequency.ONCE_DAILY:
        times = ["08:00"];
        break;
      case ReminderFrequency.TWICE_DAILY:
        times = ["08:00", "20:00"]; // 12-hour split
        break;
      case ReminderFrequency.THRICE_DAILY:
        times = ["08:00", "14:00", "20:00"]; // 6-hour split during waking hours
        break;
      case ReminderFrequency.FOUR_TIMES_DAILY:
        times = ["08:00", "12:00", "16:00", "20:00"]; // 4-hour split
        break;
      case ReminderFrequency.CUSTOM:
        times = ["08:00"]; // Fallback for custom
        break;
    }

    return { startDate, endDate, times };
  }

  async submitPostVisitData(
    appointmentId: string,
    patientId: string,
    diagnosis: string,
    notes: string,
    medications: MedicationInput[],
    followUpDate?: Date
  ) {
    // 1. Transactional DB updates to ensure data integrity
    const appointment = await this.prisma.$transaction(async (tx) => {
      // Mark COMPLETED
      const appt = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.COMPLETED }
      });

      // Save clinical notes
      await tx.visitNote.create({
        data: {
          appointmentId,
          diagnosis,
          notes,
          followUpDate
        }
      });

      // Save Prescription (only if meds exist)
      if (medications.length > 0) {
        const prescription = await tx.prescription.create({
          data: {
            appointmentId,
            medications: medications as any // Primate JSON type
          }
        });

        // Generate Reminders
        for (const med of medications) {
          const schedule = this.calculateReminderSchedule(med.frequency, med.durationDays);
          
          await tx.medicationReminder.create({
            data: {
              prescriptionId: prescription.id,
              patientId,
              medicationName: med.name,
              dosage: med.dosage,
              frequency: med.frequency,
              startDate: schedule.startDate,
              endDate: schedule.endDate,
              reminderTimes: schedule.times
            }
          });
        }
      }

      return appt;
    });

    // 2. LLM Summary Call (After transaction commits)
    // Ensures the visit is COMPLETED even if the LLM fails completely
    if (this.summaryService && notes.trim() !== "") {
      const summaryResult = await this.summaryService.generatePostVisitSummary(notes);

      await this.prisma.postVisitSummary.create({
        data: {
          appointmentId,
          patientFriendlyText: summaryResult.patientFriendlyText,
          rawOutput: summaryResult.rawOutput,
          status: summaryResult.status
        }
      });

      // 3. Queue background retry if it failed
      if (summaryResult.status === "PENDING_REVIEW") {
        await this.enqueueSummaryRetry(appointmentId);
      }
    }

    return appointment;
  }

  /**
   * Enqueues a background job to retry the LLM summary generation.
   */
  private async enqueueSummaryRetry(appointmentId: string) {
    if (this.queue) {
      await this.queue.enqueue(JobType.LLM_RETRY, { appointmentId });
      console.log(`[Queue] Enqueued background retry for PostVisitSummary on appointment ${appointmentId}`);
    } else {
      console.warn(`[Queue] Enqueueing background retry for PostVisitSummary on appointment ${appointmentId}...`);
    }
  }
}
