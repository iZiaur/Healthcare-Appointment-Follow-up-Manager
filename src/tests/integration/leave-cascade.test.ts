import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, AppointmentStatus, LeaveStatus } from "@prisma/client";
import { LeaveService } from "../../lib/admin/leave-service";
import { JobQueue } from "../../jobs/queue";

const prisma = new PrismaClient();
const queue = new JobQueue(prisma);
const leaveService = new LeaveService(prisma, queue);

describe("Leave Approval & Cancellation Cascade", () => {
  let doctorId: string;
  let patientId: string;
  let targetDate: Date;
  let appointmentId: string;

  beforeEach(async () => {
    // Clear out appointments, leaves, and jobs
    await prisma.backgroundJob.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.leaveSchedule.deleteMany({});
    
    // Get seeded doctor and patient
    const doc = await prisma.doctorProfile.findFirst();
    const pat = await prisma.patientProfile.findFirst();
    
    doctorId = doc!.id;
    patientId = pat!.id;

    // Create an appointment for tomorrow at 10 AM
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(10, 0, 0, 0);

    const appt = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotStartTime: targetDate,
        status: AppointmentStatus.CONFIRMED,
        symptoms: JSON.stringify(["Test"])
      }
    });
    appointmentId = appt.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should cascade cancel appointments and queue emails when leave is approved", async () => {
    // 1. Doctor requests leave for that day
    const leave = await prisma.leaveSchedule.create({
      data: {
        doctorId,
        date: targetDate,
        isFullDay: true,
        status: LeaveStatus.PENDING
      }
    });

    // 2. Admin approves leave
    await leaveService.approveLeave(leave.id);

    // 3. Verify Leave status
    const updatedLeave = await prisma.leaveSchedule.findUnique({ where: { id: leave.id } });
    expect(updatedLeave?.status).toBe(LeaveStatus.APPROVED);

    // 4. Verify Appointment was cancelled
    const updatedAppt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(updatedAppt?.status).toBe(AppointmentStatus.CANCELLED);

    // 5. Verify cancellation email job was queued
    const jobs = await prisma.backgroundJob.findMany({
      where: {
        type: "EMAIL_CANCELLATION",
        appointmentId
      }
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("PENDING");
  });
});
