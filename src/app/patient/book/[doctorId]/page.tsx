import { PrismaClient } from '@prisma/client';
import BookingWizard from '@/components/patient/BookingWizard';
import { notFound } from 'next/navigation';

const prisma = new PrismaClient();

export const metadata = {
  title: 'Book Appointment | MediCare',
};

export default async function BookDoctorPage({
  params,
}: {
  params: { doctorId: string };
}) {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: params.doctorId },
    include: { user: true },
  });

  if (!doctor) {
    notFound();
  }

  // Assuming Jane Smith as the logged-in patient for this demo.
  // In a real app, this comes from getServerSession()
  const patient = await prisma.patientProfile.findFirst({
    include: { user: true }
  });

  if (!patient) {
    return <div className="p-8 text-center text-gray-500">Demo Patient not found. Please run seed.</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-6 pb-8 border-b border-gray-100">
        <div className="w-20 h-20 bg-brand-secondary rounded-full flex items-center justify-center text-brand-primary text-xl font-bold">
          {doctor.user.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{doctor.user.name}</h1>
          <p className="text-lg text-brand-accent font-medium">{doctor.specialization}</p>
          <p className="text-gray-500">{doctor.qualification}</p>
        </div>
      </div>

      <BookingWizard doctorId={doctor.id} patientId={patient.id} />
    </div>
  );
}
