import { PrismaClient, AppointmentStatus } from "@prisma/client";
import { NotificationService } from "../notifications/notification-service";
import { SlotService } from "../appointments/slot-service";
import { addDays, isBefore, startOfDay, endOfDay } from "date-fns";

export class LeaveService {
  constructor(
    private prisma: PrismaClient,
    private notificationService: NotificationService,
    private slotService: SlotService
  ) {}

  /**
   * Adds leave days for a doctor, cancels conflicting appointments,
   * notifies patients, and regenerates unbooked slots to clear availability.
   */
  async addLeaveDays(
    doctorId: string,
    startDate: Date,
    endDate: Date,
    reason: string,
    adminId: string
  ): Promise<void> {
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);

    // TODO: Known Limitation - Currently only processing full-day leaves. 
    // To support partial day leaves, we need to add time overlap calculations 
    // below when finding conflicting appointments, instead of just checking the date range.

    await this.prisma.$transaction(async (tx) => {
      // 1. Create LeaveDay records for each day in range
      const leaveDaysData = [];
      // Use a simple loop to generate one record per calendar day
      for (
        let d = start;
        isBefore(d, end) || d.getTime() === start.getTime() || d.getTime() === endOfDay(start).getTime(); // handle single day
        d = addDays(d, 1)
      ) {
        // Prevent duplicate leaves for same day
        const existing = await tx.leaveDay.findFirst({
          where: { doctorId, date: startOfDay(d) }
        });
        
        if (!existing) {
          leaveDaysData.push({
            doctorId,
            date: startOfDay(d),
            reason,
            isFullDay: true
          });
        }
      }

      if (leaveDaysData.length > 0) {
        await tx.leaveDay.createMany({ data: leaveDaysData });
      }

      // 2. Find conflicting appointments (HELD, CONFIRMED)
      const conflictingAppointments = await tx.appointment.findMany({
        where: {
          doctorId,
          slotStartTime: { gte: start, lte: end },
          status: { in: [AppointmentStatus.HELD, AppointmentStatus.CONFIRMED] }
        }
      });

      // 3. Cancel them
      if (conflictingAppointments.length > 0) {
        await tx.appointment.updateMany({
          where: { id: { in: conflictingAppointments.map(a => a.id) } },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledBy: adminId,
            cancelReason: `Doctor leave: ${reason}`
          }
        });

        // 4. Notify patients (send all notifications concurrently)
        // Hooked directly into NotificationService as single call site for emails later
        const notifications = conflictingAppointments.map(appt => 
          this.notificationService.notifyAppointmentCancelled(
            appt.patientId,
            appt.id,
            `Doctor is unavailable. Reason: ${reason}`
          )
        );
        await Promise.all(notifications);
      }
    });

    // 5. Regenerate future slots to reflect the new leave days.
    // The slot service will see the new LeaveDay rows, skip those days, 
    // and naturally delete the previously-generated unbooked slots for those dates.
    await this.slotService.regenerateFutureSlots(doctorId);
  }
}
