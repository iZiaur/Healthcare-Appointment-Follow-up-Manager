import { PrismaClient, JobType } from "@prisma/client";
import { JobQueue } from "./queue";
import { 
  buildAppointmentReminder, 
  buildMedicationReminder 
} from "../lib/email/templates";
import { addHours, format, startOfHour, endOfHour } from "date-fns";

export class CronService {
  constructor(
    private prisma: PrismaClient,
    private queue: JobQueue
  ) {}

  /**
   * Scans for appointments occurring exactly 24 hours from now
   * and queues a reminder email. Expected to run every 15 minutes.
   */
  async checkAppointmentReminders(): Promise<{ processed: number, failed: number }> {
    // We check 24h ahead, rounding to the nearest 15m window
    const targetTimeStart = new Date();
    targetTimeStart.setHours(targetTimeStart.getHours() + 24);
    // Align to 15m boundary
    const minutes = Math.floor(targetTimeStart.getMinutes() / 15) * 15;
    targetTimeStart.setMinutes(minutes, 0, 0);
    
    // Window ends 15 mins later
    const targetTimeEnd = new Date(targetTimeStart.getTime() + 15 * 60000);

    const upcomingAppointments = await this.prisma.appointment.findMany({
      where: {
        status: "CONFIRMED",
        slotStartTime: {
          gte: targetTimeStart,
          lt: targetTimeEnd // Strict less than to avoid overlaps
        }
      },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } }
      }
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const appt of upcomingAppointments) {
      try {
        const html = buildAppointmentReminder(
          appt.patient.user.name,
          appt.doctor.user.name,
          appt.slotStartTime
        );

        await this.queue.enqueue(JobType.EMAIL, {
          to: appt.patient.user.email,
          subject: "Reminder: Upcoming Appointment",
          html
        });
        
        processedCount++;
      } catch (err) {
        failedCount++;
      }
    }
    
    return { processed: processedCount, failed: failedCount };
  }

  /**
   * Scans for medication reminders scheduled for the current 15-minute window
   * and queues an email. Expected to run every 15 minutes.
   */
  async checkMedicationReminders(): Promise<{ processed: number, failed: number }> {
    const now = new Date();
    // Align to 15m boundary
    const minutes = Math.floor(now.getMinutes() / 15) * 15;
    now.setMinutes(minutes, 0, 0);

    // E.g., "08:15"
    const currentWindowString = format(now, "HH:mm");

    // Active reminders where today is between start/end dates
    const activeReminders = await this.prisma.medicationReminder.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now }
      },
      include: {
        patient: { include: { user: true } }
      }
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const reminder of activeReminders) {
      const times = reminder.reminderTimes as string[];
      
      // Since times are strings like "08:00", we can check if it strictly matches our 15m window
      if (times.includes(currentWindowString)) {
        try {
          const html = buildMedicationReminder(
            reminder.patient.user.name,
            reminder.medicationName,
            reminder.dosage,
            "Please check your patient portal for detailed instructions."
          );

          await this.queue.enqueue(JobType.EMAIL, {
            to: reminder.patient.user.email,
            subject: `Medication Reminder: ${reminder.medicationName}`,
            html
          });
          
          processedCount++;
        } catch (err) {
          failedCount++;
        }
      }
    }
    
    return { processed: processedCount, failed: failedCount };
  }
}
