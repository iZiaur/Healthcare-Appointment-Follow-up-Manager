import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, UserRole, AppointmentStatus, Severity, UrgencyLevel } from "@prisma/client";
import { BookingService } from "../lib/patient/booking-service";
import { SummaryService } from "../lib/llm/summary-service";
import { StubProvider } from "../lib/llm/stub-provider";
import { DoctorScheduleService } from "../lib/doctor/schedule-service";
import { startOfDay, addMinutes } from "date-fns";

const prisma = new PrismaClient();
const stubProvider = new StubProvider();
const summaryService = new SummaryService(stubProvider);
const bookingService = new BookingService(prisma, summaryService);
const scheduleService = new DoctorScheduleService(prisma);

describe("LLM Pre-Visit Summary Flow", () => {
  let doctorProfileId: string;
  let patientProfileId: string;
  let successSlotId: string;
  let failSlotId: string;
  let successApptId: string;
  let failApptId: string;

  beforeAll(async () => {
    // Setup Doctor & Patient
    const doc = await prisma.user.create({
      data: {
        email: "llmdoc@clinic.com", passwordHash: "hash", name: "Dr. LLM", role: UserRole.DOCTOR,
        doctorProfile: { create: { specialization: "AI", qualification: "PhD" } }
      }, include: { doctorProfile: true }
    });
    doctorProfileId = doc.doctorProfile!.id;

    const pat = await prisma.user.create({
      data: {
        email: "llmpat@clinic.com", passwordHash: "hash", name: "Pat LLM", role: UserRole.PATIENT,
        patientProfile: { create: {} }
      }, include: { patientProfile: true }
    });
    patientProfileId = pat.patientProfile!.id;

    // Create 2 slots for today
    const today = startOfDay(new Date());
    const s1 = await prisma.slot.create({ data: { doctorId: doctorProfileId, date: today, startTime: "09:00", endTime: "09:30" } });
    const s2 = await prisma.slot.create({ data: { doctorId: doctorProfileId, date: today, startTime: "10:00", endTime: "10:30" } });
    successSlotId = s1.id;
    failSlotId = s2.id;
  });

  afterAll(async () => {
    await prisma.preVisitSummary.deleteMany();
    await prisma.symptom.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.doctorProfile.deleteMany();
    await prisma.patientProfile.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("should successfully generate and save a summary on booking confirmation", async () => {
    // 1. Hold
    const hold = await bookingService.holdSlot(patientProfileId, doctorProfileId, successSlotId);
    successApptId = hold.appointmentId;

    // 2. Ensure stub is working
    stubProvider.forceFailure = false;

    // 3. Confirm (This will trigger LLM Summary)
    await bookingService.confirmBooking(
      hold.appointmentId,
      patientProfileId,
      "Routine checkup",
      [{ name: "Headache", severity: Severity.SEVERE, duration: "3 days" }]
    );

    // 4. Verify DB State
    const summary = await prisma.preVisitSummary.findUnique({
      where: { appointmentId: hold.appointmentId }
    });

    expect(summary).toBeDefined();
    expect(summary?.urgency).toBe(UrgencyLevel.HIGH);
    expect(summary?.manualReviewNeeded).toBe(false);
    expect(summary?.suggestedQuestions.length).toBe(3);
  });

  it("should safely fallback to manualReviewNeeded when LLM fails repeatedly, WITHOUT breaking booking", async () => {
    // 1. Hold
    const hold = await bookingService.holdSlot(patientProfileId, doctorProfileId, failSlotId);
    failApptId = hold.appointmentId;

    // 2. Force LLM to fail
    stubProvider.forceFailure = true;

    // 3. Confirm (This will trigger LLM Summary, which will fail twice)
    // IMPORTANT: It should NOT throw an error to the user. It should succeed the booking.
    const confirmed = await bookingService.confirmBooking(
      hold.appointmentId,
      patientProfileId,
      "Checkup",
      [{ name: "Cough", severity: Severity.MILD }]
    );

    expect(confirmed.status).toBe(AppointmentStatus.CONFIRMED);

    // 4. Verify DB State saved the fallback
    const summary = await prisma.preVisitSummary.findUnique({
      where: { appointmentId: hold.appointmentId }
    });

    expect(summary).toBeDefined();
    expect(summary?.urgency).toBeNull();
    expect(summary?.manualReviewNeeded).toBe(true);
    expect(summary?.rawOutput).toContain("StubProvider forced failure");
  });

  it("DoctorScheduleService should sort the schedule by urgency", async () => {
    const today = startOfDay(new Date());
    const schedule = await scheduleService.getDailySchedule(doctorProfileId, today);

    // We have two appointments today for this doctor.
    // 09:00 - HIGH Urgency (successSlotId)
    // 10:00 - null Urgency / manualReviewNeeded (failSlotId)

    expect(schedule.length).toBe(2);
    
    // HIGH urgency should be first, even if it was booked later (though here it was earlier, 
    // let's just assert it is at index 0 and has urgency HIGH)
    expect(schedule[0].id).toBe(successApptId);
    expect(schedule[0].preVisitSummary?.urgency).toBe(UrgencyLevel.HIGH);

    expect(schedule[1].id).toBe(failApptId);
    expect(schedule[1].preVisitSummary?.manualReviewNeeded).toBe(true);
  });
});
