import { PrismaClient, AppointmentStatus } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { format } from 'date-fns';

const prisma = new PrismaClient();

export const metadata = {
  title: 'Dashboard | MediCare Patient Portal',
};

export default async function PatientDashboard() {
  // Assume Jane Smith for demo
  const patient = await prisma.patientProfile.findFirst({
    include: { user: true }
  });

  if (!patient) return <div>No patient found.</div>;

  const appointments = await prisma.appointment.findMany({
    where: { patientId: patient.id, status: { not: 'PENDING' } },
    include: {
      doctor: { include: { user: true } }
    },
    orderBy: { slotStartTime: 'desc' }
  });

  const now = new Date();
  const upcoming = appointments.filter(a => a.slotStartTime >= now && a.status === 'CONFIRMED');
  const past = appointments.filter(a => a.slotStartTime < now || a.status === 'COMPLETED');

  // Also fetch active medication reminders
  const medications = await prisma.medicationReminder.findMany({
    where: { patientId: patient.id, isActive: true },
    orderBy: { startDate: 'desc' }
  });

  return (
    <div className="space-y-12">
      <h1 className="text-3xl font-bold text-gray-900">Welcome back, {patient.user.name.split(' ')[0]}</h1>

      {/* Upcoming Appointments */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Upcoming Appointments</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {upcoming.length === 0 ? (
            <p className="text-gray-500">No upcoming appointments.</p>
          ) : (
            upcoming.map(appt => (
              <Card key={appt.id} className="border-brand-primary/20 bg-brand-surface shadow-sm">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{appt.doctor.user.name}</h3>
                      <p className="text-brand-accent font-medium">{appt.doctor.specialization}</p>
                    </div>
                    <Badge variant="high">{format(appt.slotStartTime, 'MMM d, h:mm a')}</Badge>
                  </div>
                  
                  {/* Graceful LLM handling for Pre-visit summary */}
                  <div className="mt-4 p-4 bg-white rounded-xl border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Pre-Visit Analysis</h4>
                    {appt.pre_visit_summary_status === 'COMPLETED' ? (
                      <p className="text-sm text-gray-600 line-clamp-3">{appt.pre_visit_summary}</p>
                    ) : appt.pre_visit_summary_status === 'PENDING_REVIEW' || appt.pre_visit_summary_status === 'PENDING' ? (
                      <Alert variant="info">AI is currently analyzing your symptoms to prepare the doctor.</Alert>
                    ) : (
                      <Alert variant="warning">Summary unavailable. We've securely sent your raw symptoms to the doctor directly.</Alert>
                    )}
                  </div>
                  
                  {/* Calendar Sync Status */}
                  {appt.googleEventId ? (
                    <div className="mt-4 flex items-center text-sm text-status-success-text font-medium">
                      <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      Added to Google Calendar
                    </div>
                  ) : (
                    <div className="mt-4 text-xs text-gray-400">Calendar not connected.</div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>

      {/* Medication Reminders */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Active Medications</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {medications.length === 0 ? (
            <p className="text-gray-500">No active medication schedules.</p>
          ) : (
            medications.map(med => (
              <Card key={med.id}>
                <CardContent className="p-6">
                  <div className="w-12 h-12 bg-urgency-low-bg text-urgency-low-text rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{med.medicationName}</h3>
                  <p className="text-brand-primary font-medium">{med.dosage}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(med.reminderTimes as string[]).map(time => (
                      <Badge key={time} variant="default">{time}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>

      {/* Past Appointments */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Past Consultations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {past.length === 0 ? (
            <p className="text-gray-500">No past appointments.</p>
          ) : (
            past.map(appt => (
              <Card key={appt.id} className="opacity-90">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{appt.doctor.user.name}</h3>
                      <p className="text-sm text-gray-500">{format(appt.slotStartTime, 'MMMM d, yyyy')}</p>
                    </div>
                  </div>
                  
                  {/* Graceful LLM handling for Post-visit summary */}
                  <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Visit Summary</h4>
                    {appt.post_visit_summary_status === 'COMPLETED' ? (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">{appt.post_visit_summary}</div>
                    ) : appt.post_visit_summary_status === 'PENDING_REVIEW' || appt.post_visit_summary_status === 'PENDING' ? (
                      <Alert variant="info">The AI is currently processing the doctor's clinical notes into a patient-friendly summary.</Alert>
                    ) : (
                      <div className="text-sm text-gray-700">
                        <Alert variant="warning" className="mb-3">Summary unavailable. Displaying raw clinical notes:</Alert>
                        <div className="whitespace-pre-wrap bg-white p-3 rounded border font-mono text-xs">{appt.doctor_notes || "No notes provided."}</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
