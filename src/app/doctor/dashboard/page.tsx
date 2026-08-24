import { PrismaClient } from '@prisma/client';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { format, startOfDay, endOfDay } from 'date-fns';
import Link from 'next/link';

const prisma = new PrismaClient();

export const metadata = {
  title: 'My Schedule | MediCare Provider',
};

// Helper to rank urgency for sorting
function getUrgencyRank(urgency: string | null) {
  if (!urgency) return 3; // Uncategorized at bottom
  const upper = urgency.toUpperCase();
  if (upper.includes('HIGH')) return 0;
  if (upper.includes('MEDIUM')) return 1;
  if (upper.includes('LOW')) return 2;
  return 3;
}

// Helper for UI styling
function getUrgencyVariant(urgency: string | null): 'high' | 'medium' | 'low' | 'default' {
  if (!urgency) return 'default';
  const upper = urgency.toUpperCase();
  if (upper.includes('HIGH')) return 'high';
  if (upper.includes('MEDIUM')) return 'medium';
  if (upper.includes('LOW')) return 'low';
  return 'default';
}

export default async function DoctorDashboard() {
  // Assume Dr. Provider for demo
  const doctor = await prisma.doctorProfile.findFirst({
    include: { user: true }
  });

  if (!doctor) return <div className="p-8 text-center text-gray-500">Demo Doctor not found.</div>;

  // Fetch today's appointments
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const appointments = await prisma.appointment.findMany({
    where: { 
      doctorId: doctor.id,
      status: 'CONFIRMED',
      // For a real app, you'd filter by today:
      // slotStartTime: { gte: todayStart, lte: todayEnd }
    },
    include: {
      patient: { include: { user: true } }
    }
  });

  // Sort by Urgency first, then by time
  const sortedAppointments = appointments.sort((a, b) => {
    const rankA = getUrgencyRank(a.urgency);
    const rankB = getUrgencyRank(b.urgency);
    if (rankA !== rankB) return rankA - rankB;
    return a.slotStartTime.getTime() - b.slotStartTime.getTime();
  });

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Today's Schedule</h1>
          <p className="text-gray-500 mt-2">{format(now, 'EEEE, MMMM do, yyyy')}</p>
        </div>
        <div className="text-right">
          <span className="text-sm text-gray-500">Appointments</span>
          <p className="text-3xl font-bold text-brand-primary">{appointments.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {sortedAppointments.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm text-gray-500">
            No appointments scheduled for today.
          </div>
        ) : (
          sortedAppointments.map(appt => (
            <Card key={appt.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 sm:flex sm:items-center sm:justify-between">
                <div className="flex items-center space-x-6">
                  {/* Time Block */}
                  <div className="hidden sm:block text-center min-w-[100px] border-r border-gray-100 pr-6">
                    <p className="text-lg font-bold text-brand-primary">{format(appt.slotStartTime, 'h:mm a')}</p>
                  </div>
                  
                  {/* Patient Info */}
                  <div>
                    <div className="flex items-center space-x-3 mb-1">
                      <h3 className="text-xl font-bold text-gray-900">{appt.patient.user.name}</h3>
                      <Badge variant={getUrgencyVariant(appt.urgency)}>
                        {appt.urgency || 'Uncategorized'} Priority
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 mb-2">
                      <span className="sm:hidden font-semibold mr-2">{format(appt.slotStartTime, 'h:mm a')}</span>
                      Patient ID: {appt.patientId.split('-')[0]}
                    </p>
                    
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded line-clamp-2 max-w-xl">
                      <span className="font-semibold text-gray-900 mr-2">Reason:</span>
                      {appt.pre_visit_summary_status === 'COMPLETED' 
                        ? appt.pre_visit_summary 
                        : (appt.symptoms ? JSON.parse(appt.symptoms).join(', ') : 'No symptoms provided.')}
                    </div>
                  </div>
                </div>

                <div className="mt-4 sm:mt-0 sm:ml-6 flex-shrink-0">
                  <Link href={`/doctor/appointment/${appt.id}`}>
                    <Button variant="primary">Begin Consultation</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
