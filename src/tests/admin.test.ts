import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient, UserRole, AppointmentStatus } from "@prisma/client";
import { DoctorService } from "../lib/admin/doctor-service";
import { LeaveService } from "../lib/admin/leave-service";
import { SlotService } from "../lib/appointments/slot-service";
import { NotificationService } from "../lib/notifications/notification-service";
import { addDays, startOfDay, addMinutes, format, parse, endOfDay } from "date-fns";
import prisma from "../lib/prisma";

const slotService = new SlotService(prisma);
const doctorService = new DoctorService(prisma, slotService);
const notificationService = new NotificationService(prisma);
const leaveService = new LeaveService(prisma, notificationService, slotService);

describe("Admin Portal Features", () => {
  let adminId: string;
  let testPatientId: string;
  let testPatientProfileId: string;

  beforeAll(async () => {
    // 1. Create a test admin
    const admin = await prisma.user.create({
      data: {
        email: "testadmin@clinic.com",
        passwordHash: "hash",
        name: "Test Admin",
        role: UserRole.ADMIN,
      }
    });
    adminId = admin.id;

    // 2. Create a test patient for bookings
    const patient = await prisma.user.create({
      data: {
        email: "testpatient@clinic.com",
        passwordHash: "hash",
        name: "Test Patient",
        role: UserRole.PATIENT,
        patientProfile: {
          create: {
             bloodGroup: "O+",
          }
        }
      },
      include: { patientProfile: true }
    });
    testPatientId = patient.id;
    testPatientProfileId = patient.patientProfile!.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.availability.deleteMany();
    await prisma.leaveDay.deleteMany();
    await prisma.doctorProfile.deleteMany();
    await prisma.patientProfile.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe("DoctorService & SlotService", () => {
    let doctorId: string;
    let doctorProfileId: string;

    it("should create a doctor and automatically generate future slots", async () => {
      const today = startOfDay(new Date());
      const dayOfWeek = today.getDay(); // Create availability specifically for today to guarantee slots

      const doctor = await doctorService.createDoctor({
        email: "doc.smith@clinic.com",
        name: "Dr. Smith",
        specialization: "Cardiology",
        qualification: "MD",
        slotDuration: 30, // 30 min slots
        availability: [
          {
            dayOfWeek,
            startTime: "09:00",
            endTime: "11:00" // 4 slots: 09:00, 09:30, 10:00, 10:30
          }
        ]
      });

      doctorId = doctor.id;
      doctorProfileId = doctor.doctorProfile!.id;

      expect(doctor.doctorProfile).toBeDefined();

      // Verify slots were generated for today
      const slotsToday = await prisma.slot.findMany({
        where: {
          doctorId: doctorProfileId,
          date: today
        },
        orderBy: { startTime: 'asc' }
      });

      // 09:00 to 11:00 with 30m duration = 4 slots
      expect(slotsToday.length).toBe(4);
      expect(slotsToday[0].startTime).toBe("09:00");
      expect(slotsToday[0].endTime).toBe("09:30");
      expect(slotsToday[3].startTime).toBe("10:30");
    });

    it("should skip generating new slots that overlap with an existing booked appointment", async () => {
      const today = startOfDay(new Date());

      // 1. Manually book the 09:00 - 09:30 slot (by creating an Appointment)
      const slotStartTime = parse("09:00", "HH:mm", today);
      const slotEndTime = parse("09:30", "HH:mm", today);
      
      const appt = await prisma.appointment.create({
        data: {
          patientId: testPatientProfileId,
          doctorId: doctorProfileId,
          slotStartTime,
          slotEndTime,
          status: AppointmentStatus.CONFIRMED,
        }
      });

      // 2. Change doctor's slotDuration from 30m to 20m.
      // Availability is 09:00-11:00.
      // Expected new 20m slots: 
      // 09:00-09:20 (OVERLAPS WITH APPT -> SKIPPED)
      // 09:20-09:40 (OVERLAPS WITH APPT -> SKIPPED)
      // 09:40-10:00 (OK)
      // 10:00-10:20 (OK)
      // 10:20-10:40 (OK)
      // 10:40-11:00 (OK)

      await doctorService.updateDoctor(doctorProfileId, {
        slotDuration: 20
      });

      // 3. Verify slots for today
      const slotsToday = await prisma.slot.findMany({
        where: {
          doctorId: doctorProfileId,
          date: today
        },
        orderBy: { startTime: 'asc' }
      });

      // 4 slots generated: 09:40, 10:00, 10:20, 10:40
      expect(slotsToday.length).toBe(4);
      expect(slotsToday[0].startTime).toBe("09:40"); // The overlapping ones were correctly skipped
      expect(slotsToday[3].startTime).toBe("10:40");
      
      // And the booked appointment should still be untouched
      const checkedAppt = await prisma.appointment.findUnique({ where: { id: appt.id } });
      expect(checkedAppt?.status).toBe("CONFIRMED");
    });
  });

  describe("LeaveService & Conflict Resolution", () => {
    let doctorProfileId: string;

    beforeAll(async () => {
      // Create a fresh doctor just for leave tests
      const today = startOfDay(new Date());
      const dayOfWeek = today.getDay();

      const doctor = await doctorService.createDoctor({
        email: "doc.jones@clinic.com",
        name: "Dr. Jones",
        specialization: "Neurology",
        qualification: "MD",
        slotDuration: 30,
        availability: [
          {
            dayOfWeek,
            startTime: "09:00",
            endTime: "10:00" // 09:00, 09:30
          }
        ]
      });
      doctorProfileId = doctor.doctorProfile!.id;
    });

    it("should add a leave day, cancel conflicting appointments, and notify", async () => {
      const today = startOfDay(new Date());
      
      // 1. Spy on NotificationService
      const notifySpy = vi.spyOn(notificationService, 'notifyAppointmentCancelled');

      // 2. Book an appointment for today at 09:00
      const appt = await prisma.appointment.create({
        data: {
          patientId: testPatientProfileId,
          doctorId: doctorProfileId,
          slotStartTime: parse("09:00", "HH:mm", today),
          slotEndTime: parse("09:30", "HH:mm", today),
          status: AppointmentStatus.CONFIRMED,
        }
      });

      // Verify unbooked slots exist before leave
      let unbookedSlots = await prisma.slot.findMany({
        where: { doctorId: doctorProfileId, date: today }
      });
      // One is booked, the other (09:30) is unbooked and exists
      expect(unbookedSlots.length).toBe(1); 

      // 3. Admin adds a leave day for today
      await leaveService.addLeaveDays(
        doctorProfileId,
        today,
        today,
        "Sick leave",
        adminId
      );

      // 4. Verify Appointment is CANCELLED
      const updatedAppt = await prisma.appointment.findUnique({ where: { id: appt.id } });
      expect(updatedAppt?.status).toBe(AppointmentStatus.CANCELLED);
      expect(updatedAppt?.cancelReason).toBe("Doctor leave: Sick leave");

      // 5. Verify Notification stub was called
      expect(notifySpy).toHaveBeenCalledWith(
        testPatientProfileId,
        appt.id,
        "Doctor is unavailable. Reason: Sick leave"
      );

      // 6. Verify unbooked slots for today were deleted by SlotService
      unbookedSlots = await prisma.slot.findMany({
        where: { doctorId: doctorProfileId, date: today }
      });
      expect(unbookedSlots.length).toBe(0);

      notifySpy.mockRestore();
    });
  });
});
