import { PrismaClient } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { startOfWeek, endOfWeek } from 'date-fns';

const prisma = new PrismaClient();

export const metadata = {
  title: 'Admin Dashboard | MediCare',
};

export default async function AdminDashboard() {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  // 1. Total Doctors
  const totalDoctors = await prisma.doctorProfile.count();

  // 2. Bookings this week
  const weeklyBookings = await prisma.appointment.count({
    where: {
      createdAt: { gte: weekStart, lte: weekEnd }
    }
  });

  // 3. Cancellation Rate (All time or this month, let's do all time for simplicity)
  const totalAppointments = await prisma.appointment.count({
    where: { status: { not: 'PENDING' } } // Exclude unconfirmed holds
  });
  const cancelledAppointments = await prisma.appointment.count({
    where: { status: 'CANCELLED' }
  });
  
  const cancellationRate = totalAppointments > 0 
    ? Math.round((cancelledAppointments / totalAppointments) * 100) 
    : 0;

  // 4. Background Job Queue Health
  const pendingJobs = await prisma.backgroundJob.count({
    where: { status: 'PENDING' }
  });
  const failedJobs = await prisma.backgroundJob.count({
    where: { status: 'FAILED' }
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Platform Overview</h1>
        <p className="text-gray-500 mt-2">Key metrics and system health.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Active Doctors</h3>
            <p className="text-3xl font-bold text-gray-900">{totalDoctors}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Bookings This Week</h3>
            <p className="text-3xl font-bold text-brand-primary">{weeklyBookings}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Cancellation Rate</h3>
            <p className="text-3xl font-bold text-gray-900">{cancellationRate}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Queue Health</h3>
            <div className="flex items-baseline space-x-2">
              <p className="text-3xl font-bold text-gray-900">{pendingJobs}</p>
              <span className="text-sm text-gray-500">pending</span>
            </div>
            {failedJobs > 0 && (
              <p className="text-sm text-status-failed-text font-medium mt-1">{failedJobs} dead jobs</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Architecture Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none text-gray-600">
            <p><strong>Database:</strong> PostgreSQL via Prisma ORM</p>
            <p><strong>Background Workers:</strong> Node-cron atomic task processor (FOR UPDATE SKIP LOCKED)</p>
            <p><strong>External Integrations:</strong> LLM (Symptom & Visit Summaries), Email (Nodemailer), Google Calendar OAuth</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
