import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, UserRole, AppointmentStatus, ReminderFrequency } from "@prisma/client";
import { PostVisitService } from "../lib/doctor/post-visit-service";
import { SummaryService } from "../lib/llm/summary-service";
import { StubProvider } from "../lib/llm/stub-provider";
import { startOfDay, addDays, setHours } from "date-fns";

const prisma = new PrismaClient();
const stubProvider = new StubProvider();
const summaryService = new SummaryService(stubProvider);
const postVisitService = new PostVisitService(prisma, summaryService);

describe("Post-Visit Flow", () => {
  let doctorId: string;
  let patientId: string;
  let appointmentIdSuccess: string;
  let appointmentIdFail: string;

  beforeAll(async () => {
    // Setup test users
    const doc = await prisma.user.create({
      data: {
        email: "postdoc@clinic.com", passwordHash: "hash", name: "Dr. Post", role: UserRole.DOCTOR,
        doctorProfile: { create: { specialization: "Internal", qualification: "MD" } }
      }, include: { doctorProfile: true }
    });
    doctorId = doc.doctorProfile!.id;

    const pat = await prisma.user.create({
      data: {
        email: "postpat@clinic.com", passwordHash: "hash", name: "Pat Post", role: UserRole.PATIENT,
        patientProfile: { create: {} }
      }, include: { patientProfile: true }
    });
    patientId = pat.patientProfile!.id;

    // Create 2 CONFIRMED appointments
    const today = startOfDay(new Date());
    const slot1 = await prisma.slot.create({ data: { doctorId, date: today, startTime: "09:00", endTime: "09:30" } });
    const slot2 = await prisma.slot.create({ data: { doctorId, date: today, startTime: "10:00", endTime: "10:30" } });

    const appt1 = await prisma.appointment.create({
      data: { patientId, doctorId, slotId: slot1.id, slotStartTime: today, slotEndTime: today, status: AppointmentStatus.CONFIRMED }
    });
    appointmentIdSuccess = appt1.id;

    const appt2 = await prisma.appointment.create({
      data: { patientId, doctorId, slotId: slot2.id, slotStartTime: today, slotEndTime: today, status: AppointmentStatus.CONFIRMED }
    });
    appointmentIdFail = appt2.id;
  });

  afterAll(async () => {
    await prisma.medicationReminder.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.visitNote.deleteMany();
    await prisma.postVisitSummary.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.doctorProfile.deleteMany();
    await prisma.patientProfile.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("should calculate deterministic medication reminders accurately", () => {
    // Test twice daily for 7 days
    const scheduleTwice = postVisitService.calculateReminderSchedule(ReminderFrequency.TWICE_DAILY, 7);
    
    // Check start date is tomorrow at 8 AM
    const tomorrow8am = setHours(startOfDay(addDays(new Date(), 1)), 8);
    expect(scheduleTwice.startDate.getTime()).toBe(tomorrow8am.getTime());
    
    // End date is 6 days after start date (Total 7 days inclusive)
    const endDay = setHours(startOfDay(addDays(new Date(), 7)), 8);
    expect(scheduleTwice.endDate.getTime()).toBe(endDay.getTime());

    // Check times
    expect(scheduleTwice.times).toEqual(["08:00", "20:00"]);

    // Test four times daily for 3 days
    const scheduleFour = postVisitService.calculateReminderSchedule(ReminderFrequency.FOUR_TIMES_DAILY, 3);
    expect(scheduleFour.times).toEqual(["08:00", "12:00", "16:00", "20:00"]);
  });

  it("should successfully execute full post-visit flow", async () => {
    stubProvider.forceFailure = false;

    await postVisitService.submitPostVisitData(
      appointmentIdSuccess,
      patientId,
      "Flu",
      "Patient has high fever and cough.",
      [{
        name: "Tamiflu",
        dosage: "75mg",
        frequency: ReminderFrequency.TWICE_DAILY,
        durationDays: 5,
        instructions: "Take with food"
      }],
      addDays(new Date(), 14)
    );

    // Assertions
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentIdSuccess } });
    expect(appt?.status).toBe(AppointmentStatus.COMPLETED);

    const summary = await prisma.postVisitSummary.findUnique({ where: { appointmentId: appointmentIdSuccess } });
    expect(summary?.status).toBe("COMPLETED");
    expect(summary?.patientFriendlyText).toContain("simulated patient-friendly summary");

    const reminders = await prisma.medicationReminder.findMany({ where: { patientId } });
    expect(reminders.length).toBe(1);
    expect(reminders[0].medicationName).toBe("Tamiflu");
    expect(reminders[0].reminderTimes).toEqual(["08:00", "20:00"]);
  });

  it("should gracefully handle LLM failure during post-visit", async () => {
    stubProvider.forceFailure = true;

    await postVisitService.submitPostVisitData(
      appointmentIdFail,
      patientId,
      "Headache",
      "Tension headache, recommended rest.",
      [],
      undefined
    );

    // Assertions
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentIdFail } });
    expect(appt?.status).toBe(AppointmentStatus.COMPLETED); // MUST still be completed!

    const summary = await prisma.postVisitSummary.findUnique({ where: { appointmentId: appointmentIdFail } });
    expect(summary?.status).toBe("PENDING_REVIEW"); // Fallback status
    expect(summary?.patientFriendlyText).toBeNull();
    expect(summary?.rawOutput).toContain("StubProvider forced failure");
  });
});
