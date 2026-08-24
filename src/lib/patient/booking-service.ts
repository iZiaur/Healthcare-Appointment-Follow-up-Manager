import { PrismaClient, AppointmentStatus, AppointmentType, Severity, JobType } from "@prisma/client";
import { addMinutes, startOfDay, endOfDay } from "date-fns";
import { SummaryService } from "../llm/summary-service";
import { JobQueue } from "../../jobs/queue";
import { buildBookingConfirmation } from "../email/templates";

export const HOLD_DURATION_MINUTES = 10;

export interface SymptomInput {
  name: string;
  severity: Severity;
  duration?: string;
  notes?: string;
}

export class BookingService {
  constructor(
    private prisma: PrismaClient,
    private summaryService?: SummaryService, // Optional for backward compatibility with earlier tests
    private queue?: JobQueue
  ) {}

  /**
   * Search doctors by specialization and/or date.
   * Only returns doctors who have at least one unbooked slot on the given date (if provided).
   */
  async searchDoctors(filters: { specialization?: string; date?: Date }) {
    const where: any = {};
    if (filters.specialization) {
      where.specialization = { contains: filters.specialization, mode: "insensitive" };
    }

    if (filters.date) {
      const searchDate = startOfDay(filters.date);
      // Ensure they have at least one available slot that isn't booked
      where.slots = {
        some: {
          date: searchDate,
          isAvailable: true,
          appointments: {
            none: {
              status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.EXPIRED] }
            }
          }
        }
      };
    }

    return this.prisma.doctorProfile.findMany({
      where,
      include: { user: true }
    });
  }

  /**
   * Retrieves all available slots for a doctor on a specific date.
   * A slot is available if `isAvailable` is true AND there's no active appointment for it.
   */
  async getAvailableSlots(doctorId: string, date: Date) {
    const searchDate = startOfDay(date);
    
    return this.prisma.slot.findMany({
      where: {
        doctorId,
        date: searchDate,
        isAvailable: true,
        appointments: {
          none: {
            status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.EXPIRED] }
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });
  }

  /**
   * Places a short-lived hold on a slot for checkout.
   * Uses the DB-level partial unique index to guarantee no double-booking.
   */
  async holdSlot(patientId: string, doctorId: string, slotId: string) {
    const slot = await this.prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) {
      throw new Error("Slot not found");
    }

    // Combine date and startTime to create full timestamp
    const [hours, minutes] = slot.startTime.split(':').map(Number);
    const slotStartTime = new Date(slot.date);
    slotStartTime.setHours(hours, minutes, 0, 0);

    const [endHours, endMinutes] = slot.endTime.split(':').map(Number);
    const slotEndTime = new Date(slot.date);
    slotEndTime.setHours(endHours, endMinutes, 0, 0);

    const heldUntil = addMinutes(new Date(), HOLD_DURATION_MINUTES);

    try {
      const appointment = await this.prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          slotId,
          slotStartTime,
          slotEndTime,
          status: AppointmentStatus.HELD,
          heldUntil
        }
      });

      return {
        appointmentId: appointment.id,
        heldUntil: appointment.heldUntil
      };
    } catch (error: any) {
      // Prisma P2002 = Unique constraint failed
      if (error.code === 'P2002') {
        const authError = new Error("Slot no longer available");
        authError.name = "BookingError";
        throw authError;
      }
      throw error;
    }
  }

  /**
   * Confirms a held booking and attaches symptoms/reason.
   */
  async confirmBooking(
    appointmentId: string,
    patientId: string,
    reason: string,
    symptoms: SymptomInput[]
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId }
    });

    if (!appointment) {
      throw new Error("Appointment not found");
    }

    if (appointment.patientId !== patientId) {
      throw new Error("Unauthorized");
    }

    if (appointment.status !== AppointmentStatus.HELD) {
      throw new Error("Booking is no longer held");
    }

    if (appointment.heldUntil && appointment.heldUntil < new Date()) {
      throw new Error("Hold expired. Please select a slot again.");
    }

    // 1. Transactionally confirm the booking first, to guarantee data integrity
    const confirmedAppointment = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.CONFIRMED,
        reason,
        heldUntil: null, // Clear the hold timer
        symptoms: {
          create: symptoms
        }
      },
      include: { symptoms: true }
    });

    // 2. Call LLM for Pre-Visit Summary
    // Note: We use the summaryService if provided (it might not be in some legacy tests)
    if (this.summaryService && symptoms.length > 0) {
      const symptomsText = symptoms.map(s => `${s.name} (${s.severity}) - ${s.duration || 'unknown duration'}: ${s.notes || 'no notes'}`).join(". ");
      
      const summaryResult = await this.summaryService.generatePreVisitSummary(symptomsText);
      
      // Save it to the database
      await this.prisma.preVisitSummary.create({
        data: {
          appointmentId: appointmentId,
          urgency: summaryResult.parsed?.urgency as any,
          chiefComplaint: summaryResult.parsed?.chief_complaint,
          suggestedQuestions: summaryResult.parsed?.suggested_questions || [],
          rawOutput: summaryResult.raw,
          status: summaryResult.status
        }
      });
    }

    // 3. Queue Confirmation Email & Calendar Syncs
    if (this.queue) {
      // Need full appointment details for email and calendar
      const apptDetails = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: { include: { user: { include: { googleIntegration: true } } } },
          doctor: { include: { user: { include: { googleIntegration: true } } } }
        }
      });

      if (apptDetails) {
        // --- EMAIL ---
        const html = buildBookingConfirmation(
          apptDetails.patient.user.name,
          apptDetails.doctor.user.name,
          apptDetails.slotStartTime
        );

        await this.queue.enqueue(JobType.EMAIL, {
          to: apptDetails.patient.user.email,
          subject: "Appointment Confirmed",
          html
        });

        // --- CALENDAR SYNC (INDEPENDENT) ---
        // Only enqueue if the user has actually connected their Google Calendar
        
        // Doctor Calendar Sync
        if (apptDetails.doctor.user.googleIntegration) {
          await this.queue.enqueue(JobType.CALENDAR_SYNC, {
            userId: apptDetails.doctor.user.id,
            appointmentId: apptDetails.id,
            action: 'CREATE',
            role: 'DOCTOR'
          });
        }

        // Patient Calendar Sync
        if (apptDetails.patient.user.googleIntegration) {
          await this.queue.enqueue(JobType.CALENDAR_SYNC, {
            userId: apptDetails.patient.user.id,
            appointmentId: apptDetails.id,
            action: 'CREATE',
            role: 'PATIENT'
          });
        }
      }
    }

    return confirmedAppointment;
  }
}
