import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, UserRole, AppointmentStatus, Severity } from "@prisma/client";
import { BookingService } from "../lib/patient/booking-service";
import { HoldCleanupService } from "../jobs/hold-cleanup";
import { addMinutes, subMinutes, startOfDay, format, parse } from "date-fns";
import prisma from "../lib/prisma";

const bookingService = new BookingService(prisma);
const holdCleanupService = new HoldCleanupService(prisma);

describe("Patient Booking Flow", () => {
  let doctorProfileId: string;
  let patient1ProfileId: string;
  let patient2ProfileId: string;
  let testSlotId: string;
  
  beforeAll(async () => {
    // 1. Setup Doctor
    const docUser = await prisma.user.create({
      data: {
        email: "doc.bookingtest@clinic.com",
        passwordHash: "hash",
        name: "Dr. Booking Test",
        role: UserRole.DOCTOR,
        doctorProfile: {
          create: {
            specialization: "General",
            qualification: "MD",
            slotDuration: 30,
          }
        }
      },
      include: { doctorProfile: true }
    });
    doctorProfileId = docUser.doctorProfile!.id;

    // 2. Setup Patients
    const p1 = await prisma.user.create({
      data: {
        email: "patient1@clinic.com",
        passwordHash: "hash",
        name: "Patient One",
        role: UserRole.PATIENT,
        patientProfile: { create: {} }
      },
      include: { patientProfile: true }
    });
    patient1ProfileId = p1.patientProfile!.id;

    const p2 = await prisma.user.create({
      data: {
        email: "patient2@clinic.com",
        passwordHash: "hash",
        name: "Patient Two",
        role: UserRole.PATIENT,
        patientProfile: { create: {} }
      },
      include: { patientProfile: true }
    });
    patient2ProfileId = p2.patientProfile!.id;

    // 3. Setup a single specific Slot for testing double-booking
    const today = startOfDay(new Date());
    const slot = await prisma.slot.create({
      data: {
        doctorId: doctorProfileId,
        date: today,
        startTime: "14:00",
        endTime: "14:30",
        isAvailable: true
      }
    });
    testSlotId = slot.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.doctorProfile.deleteMany();
    await prisma.patientProfile.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe("Concurrency & Double-Booking Prevention", () => {
    it("should allow only one of two simultaneous booking attempts to succeed", async () => {
      // Both patients try to book the exact same slot at the exact same millisecond.
      // Thanks to the PostgreSQL partial unique index, one will succeed and one will fail.

      const attempt1 = bookingService.holdSlot(patient1ProfileId, doctorProfileId, testSlotId);
      const attempt2 = bookingService.holdSlot(patient2ProfileId, doctorProfileId, testSlotId);

      const results = await Promise.allSettled([attempt1, attempt2]);

      // Count outcomes
      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];

      // Exactly ONE must succeed
      expect(fulfilled.length).toBe(1);
      
      // Exactly ONE must fail
      expect(rejected.length).toBe(1);

      // And it must fail cleanly with our specific error message, NOT a generic 500
      expect(rejected[0].reason.message).toBe("Slot no longer available");
      expect(rejected[0].reason.name).toBe("BookingError");
    });
  });

  describe("Hold Cleanup Service", () => {
    it("should release expired holds and mark them as EXPIRED", async () => {
      // 1. Manually create a HELD appointment that expired 5 minutes ago
      const expiredAppt = await prisma.appointment.create({
        data: {
          patientId: patient1ProfileId,
          doctorId: doctorProfileId,
          slotId: testSlotId,
          slotStartTime: parse("15:00", "HH:mm", startOfDay(new Date())),
          slotEndTime: parse("15:30", "HH:mm", startOfDay(new Date())),
          status: AppointmentStatus.HELD,
          heldUntil: subMinutes(new Date(), 5), // Expired 5 mins ago
        }
      });

      // 2. Create another HELD appointment that expires in 5 minutes (should NOT be released)
      const validAppt = await prisma.appointment.create({
        data: {
          patientId: patient2ProfileId,
          doctorId: doctorProfileId,
          slotId: testSlotId, // Sharing slot ID just for test isolation
          slotStartTime: parse("16:00", "HH:mm", startOfDay(new Date())),
          slotEndTime: parse("16:30", "HH:mm", startOfDay(new Date())),
          status: AppointmentStatus.HELD,
          heldUntil: addMinutes(new Date(), 5), // Valid for 5 more mins
        }
      });

      // 3. Run cleanup
      const releasedCount = await holdCleanupService.releaseExpiredHolds();

      // Only the 1 expired appointment should be updated
      expect(releasedCount).toBe(1);

      // Verify the expired one changed status
      const updatedExpired = await prisma.appointment.findUnique({ where: { id: expiredAppt.id } });
      expect(updatedExpired?.status).toBe(AppointmentStatus.EXPIRED);
      expect(updatedExpired?.cancelReason).toBe("Checkout hold expired");

      // Verify the valid one did not change
      const updatedValid = await prisma.appointment.findUnique({ where: { id: validAppt.id } });
      expect(updatedValid?.status).toBe(AppointmentStatus.HELD);
    });
  });

  describe("Confirm Booking", () => {
    it("should successfully confirm a valid hold and attach symptoms", async () => {
      // 1. Create valid hold
      const hold = await bookingService.holdSlot(patient1ProfileId, doctorProfileId, testSlotId);

      // 2. Confirm it
      const confirmed = await bookingService.confirmBooking(
        hold.appointmentId,
        patient1ProfileId,
        "Routine checkup",
        [{ name: "Headache", severity: Severity.MILD }]
      );

      // 3. Assertions
      expect(confirmed.status).toBe(AppointmentStatus.CONFIRMED);
      expect(confirmed.heldUntil).toBeNull();
      expect(confirmed.symptoms.length).toBe(1);
      expect(confirmed.symptoms[0].name).toBe("Headache");
    });
  });
});
