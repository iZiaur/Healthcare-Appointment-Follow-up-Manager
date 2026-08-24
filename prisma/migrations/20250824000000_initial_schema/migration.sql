-- ============================================================================
-- Healthcare Appointment & Follow-up Manager
-- Initial Migration: Create all tables, enums, indexes, and constraints
-- ============================================================================
-- Database: PostgreSQL
-- Generated from: prisma/schema.prisma
-- ============================================================================

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────

CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
CREATE TYPE "AppointmentStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED');
CREATE TYPE "AppointmentType" AS ENUM ('IN_PERSON', 'FOLLOW_UP', 'TELECONSULT');
CREATE TYPE "CancelledBy" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN', 'SYSTEM');
CREATE TYPE "Severity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');
CREATE TYPE "NotificationType" AS ENUM ('APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_REMINDER', 'PRESCRIPTION_READY', 'MEDICATION_REMINDER', 'GENERAL');
CREATE TYPE "ReminderFrequency" AS ENUM ('ONCE_DAILY', 'TWICE_DAILY', 'THRICE_DAILY', 'FOUR_TIMES_DAILY', 'CUSTOM');
CREATE TYPE "UrgencyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "SummaryStatus" AS ENUM ('COMPLETED', 'PENDING_REVIEW', 'FAILED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED');
CREATE TYPE "JobType" AS ENUM ('EMAIL', 'LLM_RETRY', 'CALENDAR_SYNC');

-- ─────────────────────────────────────────────
-- 1. USERS
-- ─────────────────────────────────────────────

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PATIENT',
    "avatar" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");

-- ─────────────────────────────────────────────
-- 1c. GOOGLE INTEGRATIONS
-- ─────────────────────────────────────────────

CREATE TABLE "google_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_integrations_userId_key" ON "google_integrations"("userId");

ALTER TABLE "google_integrations"
    ADD CONSTRAINT "google_integrations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 1b. REFRESH TOKENS (JWT rotation)
-- ─────────────────────────────────────────────

CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "replacedByToken" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

ALTER TABLE "refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 2. DOCTOR PROFILES
-- ─────────────────────────────────────────────

CREATE TABLE "doctor_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "consultationFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slotDuration" INTEGER NOT NULL DEFAULT 30,
    "bio" TEXT,
    "maxPatientsPerDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "doctor_profiles_userId_key" ON "doctor_profiles"("userId");

ALTER TABLE "doctor_profiles"
    ADD CONSTRAINT "doctor_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 3. PATIENT PROFILES
-- ─────────────────────────────────────────────

CREATE TABLE "patient_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "bloodGroup" TEXT,
    "allergies" TEXT,
    "address" TEXT,
    "emergencyContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_profiles_userId_key" ON "patient_profiles"("userId");

ALTER TABLE "patient_profiles"
    ADD CONSTRAINT "patient_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 4. AVAILABILITY (Weekly recurring schedule)
-- ─────────────────────────────────────────────

CREATE TABLE "availability" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "availability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "availability_doctor_day_time" ON "availability"("doctorId", "dayOfWeek", "startTime");
CREATE INDEX "availability_doctorId_dayOfWeek_idx" ON "availability"("doctorId", "dayOfWeek");

ALTER TABLE "availability"
    ADD CONSTRAINT "availability_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 5. SLOTS (Concrete time slots per date)
-- ─────────────────────────────────────────────

CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slot_doctor_date_time" ON "slots"("doctorId", "date", "startTime");
CREATE INDEX "slots_doctorId_date_isAvailable_idx" ON "slots"("doctorId", "date", "isAvailable");

ALTER TABLE "slots"
    ADD CONSTRAINT "slots_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 6. APPOINTMENTS
-- ─────────────────────────────────────────────

CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "slotId" TEXT,
    "slotStartTime" TIMESTAMP(3) NOT NULL,
    "slotEndTime" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'HELD',
    "heldUntil" TIMESTAMP(3),
    "type" "AppointmentType" NOT NULL DEFAULT 'IN_PERSON',
    "reason" TEXT,
    "cancelledBy" "CancelledBy",
    "cancelReason" TEXT,
    "doctorGoogleEventId" TEXT,
    "patientGoogleEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  CRITICAL: Partial Unique Index for Double-Booking Prevention    ║
-- ║                                                                  ║
-- ║  This constraint makes it STRUCTURALLY IMPOSSIBLE at the DB      ║
-- ║  level for two non-cancelled Appointment rows to occupy the      ║
-- ║  same (doctorId, slotStartTime).                                 ║
-- ║                                                                  ║
-- ║  - HELD appointments BLOCK the slot (hold during checkout)       ║
-- ║  - CONFIRMED appointments BLOCK the slot (confirmed booking)     ║
-- ║  - COMPLETED / NO_SHOW BLOCK the slot (historical record)       ║
-- ║  - CANCELLED appointments FREE the slot (allows rebooking)       ║
-- ║                                                                  ║
-- ║  When a HELD appointment's heldUntil expires, a cleanup job      ║
-- ║  sets status = CANCELLED, which releases the unique constraint   ║
-- ║  and allows another patient to book that slot.                   ║
-- ╚═══════════════════════════════════════════════════════════════════╝

CREATE UNIQUE INDEX "appointment_no_double_book"
    ON "appointments" ("doctorId", "slotStartTime")
    WHERE "status" NOT IN ('CANCELLED', 'EXPIRED');

-- Standard indexes for high-traffic queries
CREATE INDEX "appointment_doctor_schedule" ON "appointments"("doctorId", "slotStartTime");
CREATE INDEX "appointment_patient_history" ON "appointments"("patientId", "createdAt");
CREATE INDEX "appointment_hold_cleanup" ON "appointments"("status", "heldUntil");

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_slotId_fkey"
    FOREIGN KEY ("slotId") REFERENCES "slots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 7. SYMPTOMS
-- ─────────────────────────────────────────────

CREATE TABLE "symptoms" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MILD',
    "duration" TEXT,
    "notes" TEXT,

    CONSTRAINT "symptoms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "symptoms_appointmentId_idx" ON "symptoms"("appointmentId");

ALTER TABLE "symptoms"
    ADD CONSTRAINT "symptoms_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 8. VISIT NOTES
-- ─────────────────────────────────────────────

CREATE TABLE "visit_notes" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "examination" TEXT,
    "notes" TEXT,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visit_notes_appointmentId_key" ON "visit_notes"("appointmentId");

ALTER TABLE "visit_notes"
    ADD CONSTRAINT "visit_notes_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 9. PRESCRIPTIONS
-- ─────────────────────────────────────────────

CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "medications" JSONB NOT NULL,
    "advice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescriptions_appointmentId_key" ON "prescriptions"("appointmentId");

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 10. MEDICATION REMINDERS
-- ─────────────────────────────────────────────

CREATE TABLE "medication_reminders" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" "ReminderFrequency" NOT NULL,
    "reminderTimes" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medication_reminders_patientId_isActive_idx" ON "medication_reminders"("patientId", "isActive");
CREATE INDEX "medication_reminders_prescriptionId_idx" ON "medication_reminders"("prescriptionId");

ALTER TABLE "medication_reminders"
    ADD CONSTRAINT "medication_reminders_prescriptionId_fkey"
    FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medication_reminders"
    ADD CONSTRAINT "medication_reminders_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 11. NOTIFICATIONS
-- ─────────────────────────────────────────────

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 12. LEAVE DAYS
-- ─────────────────────────────────────────────

CREATE TABLE "leave_days" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "isFullDay" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,

    CONSTRAINT "leave_days_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_doctor_date" ON "leave_days"("doctorId", "date");

ALTER TABLE "leave_days"
    ADD CONSTRAINT "leave_days_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 13. PRE-VISIT SUMMARIES
-- ─────────────────────────────────────────────

CREATE TABLE "pre_visit_summaries" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "urgency" "UrgencyLevel",
    "chiefComplaint" TEXT,
    "suggestedQuestions" TEXT[],
    "rawOutput" TEXT NOT NULL,
    "status" "SummaryStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_visit_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pre_visit_summaries_appointmentId_key" ON "pre_visit_summaries"("appointmentId");

ALTER TABLE "pre_visit_summaries"
    ADD CONSTRAINT "pre_visit_summaries_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 14. POST-VISIT SUMMARIES
-- ─────────────────────────────────────────────

CREATE TABLE "post_visit_summaries" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientFriendlyText" TEXT,
    "rawOutput" TEXT,
    "status" "SummaryStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_visit_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "post_visit_summaries_appointmentId_key" ON "post_visit_summaries"("appointmentId");

ALTER TABLE "post_visit_summaries"
    ADD CONSTRAINT "post_visit_summaries_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 15. BACKGROUND JOBS
-- ─────────────────────────────────────────────

CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_background_job_polling" ON "background_jobs"("status", "nextRetryAt");
