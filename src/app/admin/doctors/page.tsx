import { PrismaClient } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { format } from 'date-fns';
import LeaveManager from '@/components/admin/LeaveManager';

const prisma = new PrismaClient();

export const metadata = {
  title: 'Doctor Management | MediCare Admin',
};

export default async function AdminDoctorsPage() {
  const doctors = await prisma.doctorProfile.findMany({
    include: { 
      user: true,
      leaves: {
        orderBy: { date: 'asc' }
      }
    }
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Doctor Management</h1>
        <p className="text-gray-500 mt-2">Manage providers and their schedule leaves.</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {doctors.map(doc => (
          <Card key={doc.id}>
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
                <div className="flex items-center space-x-4 mb-4 md:mb-0">
                  <div className="w-12 h-12 bg-gray-200 text-gray-700 rounded-full flex items-center justify-center font-bold text-lg">
                    {doc.user.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{doc.user.name}</h3>
                    <p className="text-brand-accent font-medium">{doc.specialization}</p>
                    <p className="text-sm text-gray-500">{doc.user.email}</p>
                  </div>
                </div>
              </div>

              {/* Leave Requests */}
              <div className="mt-6 pt-6 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">Leave Schedule</h4>
                {doc.leaves.length === 0 ? (
                  <p className="text-sm text-gray-500">No leave requests.</p>
                ) : (
                  <div className="space-y-3">
                    {doc.leaves.map(leave => (
                      <div key={leave.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="flex items-center space-x-3">
                          <span className="font-medium text-gray-900">{format(leave.date, 'MMM d, yyyy')}</span>
                          <Badge variant={leave.isFullDay ? 'default' : 'medium'}>
                            {leave.isFullDay ? 'Full Day' : 'Partial Day'}
                          </Badge>
                        </div>
                        <LeaveManager leave={leave} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
