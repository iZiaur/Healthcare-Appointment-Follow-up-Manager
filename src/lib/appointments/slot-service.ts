import { PrismaClient, AppointmentStatus } from "@prisma/client";
import { addDays, startOfDay, addMinutes, isBefore, isAfter, parse, format, endOfDay, areIntervalsOverlapping } from "date-fns";

export const SLOT_GENERATION_HORIZON_DAYS = 30; // Configurable constant for rolling horizon

export class SlotService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Regenerates future slots for a doctor up to the horizon.
   * - Deletes existing unbooked future slots
   * - Keeps booked slots completely untouched
   * - Generates new unbooked slots based on current Availability & slotDuration
   * - Automatically skips generating any new slot that overlaps with a booked appointment
   */
  async regenerateFutureSlots(
    doctorId: string,
    horizonDays = SLOT_GENERATION_HORIZON_DAYS
  ): Promise<void> {
    const today = startOfDay(new Date());
    const horizonDate = addDays(today, horizonDays);

    // 1. Fetch Doctor (for slotDuration, Availability rules, LeaveDays)
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
      include: {
        availability: true,
        leaveDays: {
          where: {
            date: { gte: today, lte: horizonDate },
            isFullDay: true, // Known Limitation: currently only handling full-day leaves
          }
        }
      }
    });

    if (!doctor) throw new Error("Doctor not found");

    const { slotDuration, availability, leaveDays } = doctor;

    // 2. Fetch existing booked appointments in horizon
    const bookedAppointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        slotStartTime: { gte: today, lte: endOfDay(horizonDate) },
        status: { notIn: [AppointmentStatus.CANCELLED] } // HELD, CONFIRMED, COMPLETED, NO_SHOW
      }
    });

    // 3. Prepare the new slots in memory
    const newSlotsToCreate: { doctorId: string; date: Date; startTime: string; endTime: string; isAvailable: boolean }[] = [];

    // Map leaves for quick O(1) lookup
    const leaveDayStrings = new Set(leaveDays.map(ld => format(ld.date, 'yyyy-MM-dd')));

    // 4. Loop through each day from today to horizon
    for (
      let current = today;
      isBefore(current, horizonDate) || current.getTime() === horizonDate.getTime();
      current = addDays(current, 1)
    ) {
      const dateStr = format(current, 'yyyy-MM-dd');

      // Skip if marked as a full leave day
      if (leaveDayStrings.has(dateStr)) {
        continue;
      }

      const dayOfWeek = current.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

      // Find all active availability windows for this day of week
      const dayAvailabilities = availability.filter(a => a.dayOfWeek === dayOfWeek && a.isActive);

      for (const avail of dayAvailabilities) {
        // Parse "HH:mm" strings to Date objects relative to `current` date
        const availStart = parse(avail.startTime, "HH:mm", current);
        const availEnd = parse(avail.endTime, "HH:mm", current);

        let slotStart = availStart;

        while (isBefore(slotStart, availEnd)) {
          const slotEnd = addMinutes(slotStart, slotDuration);

          // Ensure we don't bleed past the availability window
          if (isAfter(slotEnd, availEnd)) {
            break;
          }

          // OVERLAP CHECK: Prevent new slots from colliding with booked ones
          // E.g., Doctor changed duration from 30m -> 20m.
          // Old booked slot: 09:00 - 09:30.
          // New generator tries 09:00-09:20 (overlaps), 09:20-09:40 (overlaps).
          // Both will be skipped. 09:40-10:00 is fine.
          const hasOverlap = bookedAppointments.some(appt => {
            return areIntervalsOverlapping(
              { start: slotStart, end: slotEnd },
              { start: appt.slotStartTime, end: appt.slotEndTime },
              { inclusive: false } // adjacent slots don't overlap (09:00-09:30 and 09:30-10:00 are OK)
            );
          });

          if (!hasOverlap) {
            newSlotsToCreate.push({
              doctorId,
              date: current,
              startTime: format(slotStart, "HH:mm"),
              endTime: format(slotEnd, "HH:mm"),
              isAvailable: true
            });
          }

          slotStart = slotEnd;
        }
      }
    }

    // 5. Apply changes via Database Transaction
    // Unbooked slots are defined as Slots that do NOT have a matching active Appointment.
    const bookedSlotIds = bookedAppointments.map(a => a.slotId).filter(Boolean) as string[];

    await this.prisma.$transaction(async (tx) => {
      // Step A: Delete all unbooked future slots
      await tx.slot.deleteMany({
        where: {
          doctorId,
          date: { gte: today, lte: horizonDate },
          id: { notIn: bookedSlotIds }
        }
      });

      // Step B: Insert the new valid unbooked slots
      if (newSlotsToCreate.length > 0) {
        await tx.slot.createMany({
          data: newSlotsToCreate,
          skipDuplicates: true // Gracefully ignore if a perfectly aligned booked slot exists
        });
      }
    });
  }
}
