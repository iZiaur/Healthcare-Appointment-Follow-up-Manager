import { PrismaClient, NotificationType, JobType } from "@prisma/client";
import { JobQueue } from "../../jobs/queue";
import { buildCancellation } from "../email/templates";

export class NotificationService {
  constructor(
    private prisma: PrismaClient,
    private queue?: JobQueue // Optional for backward compatibility with old tests
  ) {}

  /**
   * Single call site for all appointment cancellation notifications.
   * Dispatches in-app notification and queues an email.
   */
  async notifyAppointmentCancelled(
    patientId: string,
    appointmentId: string,
    reason: string
  ): Promise<void> {
    // 1. Fetch user details to get email address (for the stub log)
    const patientProfile = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      include: { user: { include: { googleIntegration: true } } },
    });

    if (!patientProfile) {
      console.warn(`Could not send cancellation notification: Patient Profile ${patientId} not found.`);
      return;
    }

    const title = "Appointment Cancelled";
    const message = `Your appointment has been cancelled. Reason: ${reason}`;

    // 2. Insert into in-app Notification table
    await this.prisma.notification.create({
      data: {
        userId: patientProfile.userId,
        type: NotificationType.APPOINTMENT_CANCELLED,
        title,
        message,
        link: `/patient/appointments/${appointmentId}`, // Deep link for in-app
      },
    });

    // 3. Queue the actual email delivery
    if (this.queue) {
      // Need doctor's name and appointment date
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: { include: { user: { include: { googleIntegration: true } } } } }
      });

      if (appointment) {
        const html = buildCancellation(
          patientProfile.user.name,
          appointment.doctor.user.name,
          appointment.slotStartTime,
          reason
        );

        await this.queue.enqueue(JobType.EMAIL, {
          to: patientProfile.user.email,
          subject: title,
          html
        });

        // --- CALENDAR SYNC (DELETE) ---
        // Patient
        if (patientProfile.user.googleIntegration) {
          await this.queue.enqueue(JobType.CALENDAR_SYNC, {
            userId: patientProfile.user.id,
            appointmentId: appointment.id,
            action: 'DELETE',
            role: 'PATIENT'
          });
        }
        
        // Doctor
        if (appointment.doctor.user.googleIntegration) {
          await this.queue.enqueue(JobType.CALENDAR_SYNC, {
            userId: appointment.doctor.user.id,
            appointmentId: appointment.id,
            action: 'DELETE',
            role: 'DOCTOR'
          });
        }
      }
    } else {
      console.log("---------------------------------------------------");
      console.log("📧 MOCK EMAIL NOTIFICATION SENT");
      console.log(`To: ${patientProfile.user.email} (${patientProfile.user.name})`);
      console.log(`Subject: ${title}`);
      console.log(`Body: ${message}`);
      console.log("---------------------------------------------------");
    }
  }
}
