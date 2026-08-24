import { format } from "date-fns";

/**
 * Very basic inline CSS applied to all templates for modern readability.
 */
const BASE_STYLE = `
  font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  color: #333333;
  line-height: 1.6;
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
`;

export const buildBookingConfirmation = (
  patientName: string, 
  doctorName: string, 
  date: Date
) => `
  <div style="${BASE_STYLE}">
    <h2 style="color: #2c3e50; margin-top: 0;">Appointment Confirmed</h2>
    <p>Dear ${patientName},</p>
    <p>Your appointment with <strong>${doctorName}</strong> has been successfully booked.</p>
    <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <strong>Date & Time:</strong> ${format(date, "EEEE, MMMM do, yyyy 'at' h:mm a")}
    </div>
    <p>Please arrive 5 minutes early. If you need to cancel, please do so at least 24 hours in advance.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
    <p style="font-size: 0.85em; color: #7f8c8d;">This is an automated message from your Healthcare Clinic.</p>
  </div>
`;

export const buildCancellation = (
  patientName: string, 
  doctorName: string, 
  date: Date,
  reason?: string
) => `
  <div style="${BASE_STYLE}">
    <h2 style="color: #e74c3c; margin-top: 0;">Appointment Cancelled</h2>
    <p>Dear ${patientName},</p>
    <p>We regret to inform you that your appointment with <strong>${doctorName}</strong> on ${format(date, "MMM do, yyyy")} has been cancelled.</p>
    ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    <p>Please log in to your portal to book a new slot at your earliest convenience.</p>
    <p>We apologize for any inconvenience caused.</p>
  </div>
`;

export const buildAppointmentReminder = (
  patientName: string, 
  doctorName: string, 
  date: Date
) => `
  <div style="${BASE_STYLE}">
    <h2 style="color: #f39c12; margin-top: 0;">Appointment Reminder</h2>
    <p>Dear ${patientName},</p>
    <p>This is a quick reminder that you have an upcoming appointment with <strong>${doctorName}</strong> tomorrow.</p>
    <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <strong>Date & Time:</strong> ${format(date, "EEEE, MMMM do, yyyy 'at' h:mm a")}
    </div>
    <p>We look forward to seeing you!</p>
  </div>
`;

export const buildMedicationReminder = (
  patientName: string, 
  medicationName: string, 
  dosage: string,
  instructions?: string
) => `
  <div style="${BASE_STYLE}">
    <h2 style="color: #27ae60; margin-top: 0;">Medication Reminder</h2>
    <p>Dear ${patientName},</p>
    <p>It is time to take your medication:</p>
    <div style="background: #e8f8f5; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2ecc71;">
      <h3 style="margin: 0 0 10px 0; color: #27ae60;">${medicationName}</h3>
      <p style="margin: 0;"><strong>Dosage:</strong> ${dosage}</p>
      ${instructions ? `<p style="margin: 5px 0 0 0;"><strong>Instructions:</strong> ${instructions}</p>` : ''}
    </div>
  </div>
`;
