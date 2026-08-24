import { PrismaClient, AppointmentStatus, UrgencyLevel } from "@prisma/client";
import { startOfDay, endOfDay } from "date-fns";

export class DoctorScheduleService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Retrieves a doctor's confirmed appointments for a specific day.
   * Sorts the schedule intelligently based on the LLM's Pre-Visit Summary urgency:
   * HIGH urgency first, then MEDIUM, then LOW/null.
   * For ties in urgency, sorts by slotStartTime ascending.
   */
  async getDailySchedule(doctorId: string, date: Date) {
    const start = startOfDay(date);
    const end = endOfDay(date);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        slotStartTime: { gte: start, lte: end },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW] }
      },
      include: {
        patient: {
          include: { user: true }
        },
        preVisitSummary: true,
        symptoms: true
      },
      // Unfortunately, Prisma doesn't support complex sorting logic natively in orderBy 
      // when dealing with enum hierarchies (HIGH > MEDIUM > LOW) across relations perfectly.
      // So we pull them and sort them in-memory, which is safe since a daily schedule 
      // for a single doctor is O(10-30) records maximum.
    });

    const urgencyWeight: Record<string, number> = {
      [UrgencyLevel.HIGH]: 3,
      [UrgencyLevel.MEDIUM]: 2,
      [UrgencyLevel.LOW]: 1
    };

    appointments.sort((a, b) => {
      // 1. Sort by Urgency (Descending)
      const weightA = a.preVisitSummary?.urgency ? urgencyWeight[a.preVisitSummary.urgency] : 0;
      const weightB = b.preVisitSummary?.urgency ? urgencyWeight[b.preVisitSummary.urgency] : 0;
      
      if (weightA !== weightB) {
        return weightB - weightA;
      }

      // 2. Tie-breaker: sort chronologically
      return a.slotStartTime.getTime() - b.slotStartTime.getTime();
    });

    return appointments;
  }
}
