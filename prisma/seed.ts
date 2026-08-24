// ============================================================================
// Database Seed Script
// ============================================================================
// Creates an initial admin user, sample doctors, sample patients, and
// pre-populates the database with past and upcoming appointments for demo.
//
// Run: npx prisma db seed
// ============================================================================

import { PrismaClient, UserRole, Gender, AppointmentStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...\n");

  // ── 1. Admin User ──
  const adminPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@healthcare.com" },
    update: {},
    create: {
      email: "admin@healthcare.com",
      passwordHash: adminPassword,
      name: "System Admin",
      phone: "+1-555-000-0001",
      role: UserRole.ADMIN,
      isActive: true,
    },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // ── 2. Doctors ──
  const doctorPassword = await bcrypt.hash("doctor123", 12);

  const doctors = [
    {
      email: "dr.smith@healthcare.com",
      name: "Dr. Sarah Smith",
      phone: "+1-555-100-0001",
      profile: {
        specialization: "Cardiology",
        qualification: "MBBS, MD (Cardiology)",
        experience: 12,
        consultationFee: 150,
        slotDuration: 30,
        bio: "Experienced cardiologist specializing in preventive heart care.",
        maxPatientsPerDay: 20,
      },
      availability: [
        { dayOfWeek: 1, startTime: "09:00", endTime: "13:00" }, // Mon morning
        { dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }, // Mon afternoon
        { dayOfWeek: 2, startTime: "09:00", endTime: "13:00" }, // Tue
        { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" }, // Wed full day
        { dayOfWeek: 4, startTime: "09:00", endTime: "13:00" }, // Thu
        { dayOfWeek: 5, startTime: "10:00", endTime: "14:00" }, // Fri
      ],
    },
    {
      email: "dr.jones@healthcare.com",
      name: "Dr. Michael Jones",
      phone: "+1-555-100-0002",
      profile: {
        specialization: "General Medicine",
        qualification: "MBBS, MD",
        experience: 8,
        consultationFee: 100,
        slotDuration: 20,
        bio: "Primary care physician focusing on holistic well-being.",
        maxPatientsPerDay: 25,
      },
      availability: [
        { dayOfWeek: 1, startTime: "10:00", endTime: "14:00" },
        { dayOfWeek: 2, startTime: "10:00", endTime: "14:00" },
        { dayOfWeek: 3, startTime: "09:00", endTime: "13:00" },
        { dayOfWeek: 4, startTime: "10:00", endTime: "16:00" },
        { dayOfWeek: 5, startTime: "09:00", endTime: "12:00" },
      ],
    },
  ];

  const createdDoctors = [];
  for (const doc of doctors) {
    const user = await prisma.user.upsert({
      where: { email: doc.email },
      update: {},
      create: {
        email: doc.email,
        passwordHash: doctorPassword,
        name: doc.name,
        phone: doc.phone,
        role: UserRole.DOCTOR,
        isActive: true,
        doctorProfile: {
          create: doc.profile,
        },
      },
      include: { doctorProfile: true },
    });

    if (user.doctorProfile) {
      for (const avail of doc.availability) {
        await prisma.availability.upsert({
          where: {
            availability_doctor_day_time: {
              doctorId: user.doctorProfile.id,
              dayOfWeek: avail.dayOfWeek,
              startTime: avail.startTime,
            },
          },
          update: {},
          create: {
            doctorId: user.doctorProfile.id,
            ...avail,
            isActive: true,
          },
        });
      }
      createdDoctors.push(user.doctorProfile);
    }
    console.log(`✅ Doctor: ${user.email}`);
  }

  // ── 3. Patient ──
  const patientPassword = await bcrypt.hash("patient123", 12);
  const patientUser = await prisma.user.upsert({
    where: { email: "jane.smith@email.com" },
    update: {},
    create: {
      email: "jane.smith@email.com",
      passwordHash: patientPassword,
      name: "Jane Smith",
      phone: "+1-555-200-0001",
      role: UserRole.PATIENT,
      isActive: true,
      patientProfile: {
        create: {
          dateOfBirth: new Date("1990-05-15"),
          gender: Gender.FEMALE,
          bloodGroup: "O+",
          allergies: "Penicillin",
          address: "123 Main St",
          emergencyContact: "John Smith - +1-555-200-0010",
        },
      },
    },
    include: { patientProfile: true }
  });
  console.log(`✅ Patient: ${patientUser.email}`);

  // ── 4. Demo Appointments ──
  const now = new Date();
  
  // Past Appointment (Completed with LLM Summary)
  const pastDate = new Date(now);
  pastDate.setDate(pastDate.getDate() - 3); // 3 days ago
  pastDate.setHours(10, 0, 0, 0);
  
  await prisma.appointment.create({
    data: {
      patientId: patientUser.patientProfile!.id,
      doctorId: createdDoctors[1].id,
      slotStartTime: pastDate,
      status: AppointmentStatus.COMPLETED,
      symptoms: JSON.stringify(["Fever", "Cough"]),
      pre_visit_summary: "Patient presents with fever and cough.",
      pre_visit_summary_status: "COMPLETED",
      doctor_notes: "Patient has a mild viral infection. Prescribed rest and hydration.",
      post_visit_summary: "You have a mild viral infection. Rest and drink plenty of fluids.",
      post_visit_summary_status: "COMPLETED"
    }
  });

  // Upcoming Appointment (Confirmed, High Urgency)
  const futureDate = new Date(now);
  futureDate.setHours(futureDate.getHours() + 2); // 2 hours from now
  
  await prisma.appointment.create({
    data: {
      patientId: patientUser.patientProfile!.id,
      doctorId: createdDoctors[0].id,
      slotStartTime: futureDate,
      status: AppointmentStatus.CONFIRMED,
      symptoms: JSON.stringify(["Chest pain", "Shortness of breath"]),
      pre_visit_summary: "URGENT: Patient experiencing chest pain and shortness of breath.",
      pre_visit_summary_status: "COMPLETED",
      urgency: "HIGH",
      suggested_questions: JSON.stringify(["When did the pain start?", "Is the pain radiating?"])
    }
  });

  console.log(`✅ Seeded demo appointments for dashboard view.`);

  console.log("\n🎉 Seeding complete!");
  console.log("\n📋 Demo Credentials:");
  console.log("   Admin:   admin@healthcare.com / admin123");
  console.log("   Doctor:  dr.smith@healthcare.com / doctor123");
  console.log("   Patient: jane.smith@email.com / patient123");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
