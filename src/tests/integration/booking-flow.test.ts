import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, AppointmentStatus } from "@prisma/client";
import { BookingService } from "../../lib/patient/booking-service";
import { JobQueue } from "../../jobs/queue";

const prisma = new PrismaClient();
const queue = new JobQueue(prisma);
const bookingService = new BookingService(prisma, queue);

describe("Booking Flow & Concurrency", () => {
  let doctorId: string;
  let patientId: string;
  let patientId2: string;

  beforeEach(async () => {
    await prisma.appointment.deleteMany({});
    
    // Get seeded doctor and patients
    const doc = await prisma.doctorProfile.findFirst();
    const pat1 = await prisma.patientProfile.findFirst();
    const pat2 = await prisma.patientProfile.findMany({ take: 2 });
    
    doctorId = doc!.id;
    patientId = pat1!.id;
    patientId2 = pat2.length > 1 ? pat2[1].id : pat1!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should successfully hold and confirm a booking", async () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split("T")[0];

    // 1. Get Slots
    const slots = await bookingService.getAvailableSlots(doctorId, dateStr);
    expect(slots.length).toBeGreaterThan(0);

    const targetSlot = slots[0];

    // 2. Hold Slot
    const holdRes = await bookingService.holdSlot(patientId, doctorId, targetSlot.id);
    expect(holdRes).toBeDefined();
    expect(holdRes.appointmentId).toBeDefined();

    // 3. Confirm Slot
    const confirmRes = await bookingService.confirmBooking(
      holdRes.appointmentId,
      patientId,
      "Fever and cough",
      [{ name: "Fever", duration: "2 days", severity: "Mild" }]
    );

    expect(confirmRes.status).toBe(AppointmentStatus.CONFIRMED);
    
    // Check background jobs created (LLM and Calendar)
    const jobs = await prisma.backgroundJob.findMany({
      where: { appointmentId: holdRes.appointmentId }
    });
    expect(jobs.length).toBeGreaterThanOrEqual(1); // At least pre-visit summary job
  });

  it("should prevent concurrent bookings on the same slot (Stage 4)", async () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    const dateStr = targetDate.toISOString().split("T")[0];
    
    const slots = await bookingService.getAvailableSlots(doctorId, dateStr);
    const targetSlot = slots[0];

    // Simulate concurrent holds using Promise.allSettled
    const results = await Promise.allSettled([
      bookingService.holdSlot(patientId, doctorId, targetSlot.id),
      bookingService.holdSlot(patientId2, doctorId, targetSlot.id)
    ]);

    const successes = results.filter(r => r.status === "fulfilled");
    const failures = results.filter(r => r.status === "rejected");

    // Only one should succeed due to unique constraint on doctorId_slotStartTime
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toContain("Slot no longer available");
  });
});
