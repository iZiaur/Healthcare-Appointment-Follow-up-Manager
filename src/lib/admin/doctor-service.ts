import { PrismaClient, UserRole } from "@prisma/client";
import { SlotService } from "../appointments/slot-service";
import { hashPassword } from "../auth/password";

export interface CreateDoctorInput {
  email: string;
  password?: string;
  name: string;
  phone?: string;
  specialization: string;
  qualification: string;
  experience?: number;
  consultationFee?: number;
  slotDuration?: number;
  availability: {
    dayOfWeek: number;
    startTime: string; // HH:mm
    endTime: string;   // HH:mm
  }[];
}

export interface UpdateDoctorInput {
  name?: string;
  phone?: string;
  specialization?: string;
  qualification?: string;
  experience?: number;
  consultationFee?: number;
  slotDuration?: number;
  availability?: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }[];
}

export class DoctorService {
  constructor(private prisma: PrismaClient, private slotService: SlotService) {}

  /**
   * Admin creates a new doctor profile, user account, and initial availability.
   * Automatically generates the initial slots for the horizon.
   */
  async createDoctor(input: CreateDoctorInput) {
    const passwordHash = await hashPassword(input.password || "TempPassword123!");

    const user = await this.prisma.$transaction(async (tx) => {
      // 1. Create User & DoctorProfile
      const newUser = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
          phone: input.phone,
          role: UserRole.DOCTOR,
          doctorProfile: {
            create: {
              specialization: input.specialization,
              qualification: input.qualification,
              experience: input.experience ?? 0,
              consultationFee: input.consultationFee ?? 0,
              slotDuration: input.slotDuration ?? 30,
              availability: {
                create: input.availability.map(a => ({
                  dayOfWeek: a.dayOfWeek,
                  startTime: a.startTime,
                  endTime: a.endTime,
                  isActive: true
                }))
              }
            }
          }
        },
        include: {
          doctorProfile: true
        }
      });

      return newUser;
    });

    const doctorProfileId = user.doctorProfile!.id;

    // 2. Generate initial slots (must be outside the main transaction to avoid long locks, 
    // though it can be inside if preferred. Keeping it outside for performance).
    await this.slotService.regenerateFutureSlots(doctorProfileId);

    return user;
  }

  /**
   * Admin updates a doctor.
   * If slotDuration or availability changes, slots are automatically regenerated.
   */
  async updateDoctor(doctorId: string, input: UpdateDoctorInput) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
      include: { user: true }
    });

    if (!doctorProfile) throw new Error("Doctor not found");

    let needsSlotRegeneration = false;

    await this.prisma.$transaction(async (tx) => {
      // 1. Update User info if provided
      if (input.name || input.phone) {
        await tx.user.update({
          where: { id: doctorProfile.userId },
          data: {
            name: input.name,
            phone: input.phone
          }
        });
      }

      // 2. Update DoctorProfile info
      const profileData: any = {};
      if (input.specialization) profileData.specialization = input.specialization;
      if (input.qualification) profileData.qualification = input.qualification;
      if (input.experience !== undefined) profileData.experience = input.experience;
      if (input.consultationFee !== undefined) profileData.consultationFee = input.consultationFee;
      
      if (input.slotDuration !== undefined && input.slotDuration !== doctorProfile.slotDuration) {
        profileData.slotDuration = input.slotDuration;
        needsSlotRegeneration = true;
      }

      if (Object.keys(profileData).length > 0) {
        await tx.doctorProfile.update({
          where: { id: doctorId },
          data: profileData
        });
      }

      // 3. Update Availability if provided
      if (input.availability) {
        // Simple approach: delete old, insert new. 
        // This is safe because SlotService regenerates based on the current active Availability.
        await tx.availability.deleteMany({
          where: { doctorId }
        });

        await tx.availability.createMany({
          data: input.availability.map(a => ({
            doctorId,
            dayOfWeek: a.dayOfWeek,
            startTime: a.startTime,
            endTime: a.endTime,
            isActive: true
          }))
        });

        needsSlotRegeneration = true;
      }
    });

    // 4. Regenerate slots if schedule or duration changed
    if (needsSlotRegeneration) {
      await this.slotService.regenerateFutureSlots(doctorId);
    }

    return await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
      include: { user: true, availability: true }
    });
  }

  async getDoctors() {
    return this.prisma.doctorProfile.findMany({
      include: { user: true, availability: true }
    });
  }
}
