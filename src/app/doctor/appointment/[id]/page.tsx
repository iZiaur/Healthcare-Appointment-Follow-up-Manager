import { PrismaClient } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { format } from 'date-fns';
import { notFound } from 'next/navigation';
import PostVisitForm from '@/components/doctor/PostVisitForm';

const prisma = new PrismaClient();

export const metadata = {
  title: 'Consultation | MediCare Provider',
};

export default async function ConsultationPage({
  params,
}: {
  params: { id: string };
}) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.id },
    include: {
      patient: { include: { user: true } }
    }
  });

  if (!appointment) notFound();

  const getUrgencyVariant = (urgency: string | null): 'high' | 'medium' | 'low' | 'default' => {
    if (!urgency) return 'default';
    const upper = urgency.toUpperCase();
    if (upper.includes('HIGH')) return 'high';
    if (upper.includes('MEDIUM')) return 'medium';
    if (upper.includes('LOW')) return 'low';
    return 'default';
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header Info */}
      <div className="flex items-start justify-between pb-8 border-b border-gray-200">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Consultation: {appointment.patient.user.name}</h1>
          <p className="text-gray-500 font-medium">
            {format(appointment.slotStartTime, 'EEEE, MMMM do, yyyy h:mm a')}
          </p>
        </div>
        <div className="text-right">
          <Badge variant={getUrgencyVariant(appointment.urgency)} className="mb-2 px-3 py-1 text-sm">
            {appointment.urgency || 'Uncategorized'} Priority
          </Badge>
          <p className="text-sm text-gray-400">ID: {appointment.patientId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Pre-visit Info */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Pre-Visit Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {appointment.pre_visit_summary_status === 'COMPLETED' ? (
                <div className="prose prose-sm max-w-none text-gray-700">
                  <p className="whitespace-pre-wrap">{appointment.pre_visit_summary}</p>
                </div>
              ) : appointment.pre_visit_summary_status === 'PENDING_REVIEW' || appointment.pre_visit_summary_status === 'PENDING' ? (
                <Alert variant="info">AI is currently analyzing the patient's symptoms.</Alert>
              ) : (
                <div className="text-sm text-gray-700">
                  <Alert variant="warning" className="mb-4">AI Summary Failed. Raw symptoms below:</Alert>
                  <div className="whitespace-pre-wrap bg-gray-50 p-3 rounded-md border font-mono text-xs">
                    {appointment.symptoms ? JSON.parse(appointment.symptoms).join('\n') : 'No symptoms provided.'}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suggested Questions</CardTitle>
            </CardHeader>
            <CardContent>
              {appointment.suggested_questions ? (
                <ul className="list-disc pl-4 space-y-2 text-sm text-gray-700">
                  {(JSON.parse(appointment.suggested_questions) as string[]).map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No questions generated.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Action area */}
        <div className="lg:col-span-2">
          {appointment.status === 'COMPLETED' ? (
            <Alert variant="success">
              This consultation is marked as completed. The post-visit summary process has been triggered.
            </Alert>
          ) : (
            <PostVisitForm appointmentId={appointment.id} />
          )}
        </div>
      </div>
    </div>
  );
}
