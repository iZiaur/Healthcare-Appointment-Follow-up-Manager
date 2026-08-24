import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient, UserRole, JobType, JobStatus, AppointmentStatus } from "@prisma/client";
import { JobWorker } from "../jobs/worker";
import { JobQueue } from "../jobs/queue";
import { GoogleCalendarService } from "../lib/calendar/google-calendar";
import { EmailProvider } from "../lib/email/provider";
import { SummaryService } from "../lib/llm/summary-service";
import { BookingService } from "../lib/patient/booking-service";
import { startOfDay, addHours } from "date-fns";

const prisma = new PrismaClient();

// Stubs
class MockEmailProvider implements EmailProvider {
  async send() {}
}
class MockCalendarService extends GoogleCalendarService {
  public failPatient = false;
  
  async createEvent(userId: string, event: any): Promise<string> {
    if (this.failPatient && userId.includes("patient")) {
      const err = new Error("invalid_grant: Token has been expired or revoked.");
      (err as any).status = 401;
      throw err;
    }
    return `mock-event-id-${userId}`;
  }
}

const emailProvider = new MockEmailProvider();
const calendarService = new MockCalendarService(prisma);
const worker = new JobWorker(prisma, emailProvider, {} as SummaryService, calendarService);
const queue = new JobQueue(prisma);
const bookingService = new BookingService(prisma, undefined, queue);

describe("Calendar Sync Graceful Degradation", () => {
  let docUserId: string;
  let patUserId: string;
  let appointmentId: string;

  beforeAll(async () => {
    // 1. Setup Test Users with Google Integrations
    const docUser = await prisma.user.create({
      data: {
        email: "caldoc@test.com", passwordHash: "x", name: "Dr. Cal", role: UserRole.DOCTOR,
        doctorProfile: { create: { specialization: "GP", qualification: "MD" } },
        googleIntegration: { create: { accessToken: "x", refreshToken: "x", expiryDate: new Date() } }
      }, include: { doctorProfile: true }
    });
    docUserId = docUser.id;

    const patUser = await prisma.user.create({
      data: {
        id: "patient-123", // Give specific ID to trigger mock failure
        email: "calpat@test.com", passwordHash: "x", name: "Pat Cal", role: UserRole.PATIENT,
        patientProfile: { create: {} },
        googleIntegration: { create: { accessToken: "y", refreshToken: "y", expiryDate: new Date() } }
      }, include: { patientProfile: true }
    });
    patUserId = patUser.id;

    // 2. Setup Slot & Held Appointment
    const slot = await prisma.slot.create({ 
      data: { doctorId: docUser.doctorProfile!.id, date: startOfDay(new Date()), startTime: "09:00", endTime: "09:30" }
    });

    const appt = await prisma.appointment.create({
      data: { 
        patientId: patUser.patientProfile!.id, 
        doctorId: docUser.doctorProfile!.id, 
        slotId: slot.id, 
        slotStartTime: startOfDay(new Date()), 
        slotEndTime: addHours(startOfDay(new Date()), 1), 
        status: AppointmentStatus.HELD 
      }
    });
    appointmentId = appt.id;

    await prisma.backgroundJob.deleteMany();
  });

  afterAll(async () => {
    await prisma.googleIntegration.deleteMany();
    await prisma.backgroundJob.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.doctorProfile.deleteMany();
    await prisma.patientProfile.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("should book successfully and decouple calendar syncs", async () => {
    // We intentionally force the patient's calendar to fail with a revoked token
    calendarService.failPatient = true;

    // 1. Confirm the booking
    await bookingService.confirmBooking(appointmentId, []);

    // The booking should be CONFIRMED immediately
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appt?.status).toBe(AppointmentStatus.CONFIRMED);

    // 2. Process the background jobs
    // There should be 3 jobs (1 Email, 2 Calendar Syncs)
    const processed = await worker.processJobs();
    expect(processed).toBe(3);

    // 3. Verify Doctor Sync Succeeded
    const updatedAppt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(updatedAppt?.doctorGoogleEventId).toContain("mock-event-id");

    // 4. Verify Patient Sync Gracefully Failed
    expect(updatedAppt?.patientGoogleEventId).toBeNull();

    // Check the integration was deleted because of invalid_grant
    const patIntegration = await prisma.googleIntegration.findUnique({ where: { userId: patUserId } });
    expect(patIntegration).toBeNull(); // It was cleaned up!
    
    // Check the background job was marked COMPLETED (not FAILED or PENDING) so it doesn't retry
    const patJob = await prisma.backgroundJob.findFirst({
      where: { type: JobType.CALENDAR_SYNC, payload: { path: ["role"], equals: "PATIENT" } }
    });
    // The worker catches invalid_grant, deletes integration, and returns normally, marking it COMPLETED
    expect(patJob?.status).toBe(JobStatus.COMPLETED); 
  });
});
