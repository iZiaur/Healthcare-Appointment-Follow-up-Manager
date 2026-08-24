import { PrismaClient } from '@prisma/client';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

// Instantiate Prisma directly for Server Components
const prisma = new PrismaClient();

export const metadata = {
  title: 'Find a Doctor | MediCare',
};

export default async function DoctorsPage({
  searchParams,
}: {
  searchParams: { specialty?: string };
}) {
  const specialtyFilter = searchParams.specialty;

  const doctors = await prisma.doctorProfile.findMany({
    where: specialtyFilter ? { specialization: specialtyFilter } : undefined,
    include: { user: true },
  });

  // Get unique specialties for the filter bar
  const allDoctors = await prisma.doctorProfile.findMany({
    select: { specialization: true },
  });
  const specialties = Array.from(new Set(allDoctors.map((d) => d.specialization)));

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-brand-primary rounded-3xl p-10 text-white relative overflow-hidden shadow-lg">
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-4xl font-bold mb-4">Book an appointment for an in-clinic consultation</h1>
          <p className="text-brand-secondary text-lg mb-8">
            Find experienced specialists and book your visit instantly.
          </p>
        </div>
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-white opacity-5"></div>
        <div className="absolute bottom-0 right-40 -mb-20 w-64 h-64 rounded-full bg-brand-accent opacity-20"></div>
      </div>

      {/* Specialty Filter */}
      <div className="flex space-x-3 overflow-x-auto pb-4 scrollbar-hide">
        <Link href="/patient/doctors">
          <Badge 
            variant={!specialtyFilter ? 'high' : 'default'} 
            className="px-4 py-2 cursor-pointer text-sm whitespace-nowrap"
          >
            All Specialties
          </Badge>
        </Link>
        {specialties.map((spec) => (
          <Link key={spec} href={`/patient/doctors?specialty=${encodeURIComponent(spec)}`}>
            <Badge 
              variant={specialtyFilter === spec ? 'high' : 'default'} 
              className="px-4 py-2 cursor-pointer text-sm whitespace-nowrap"
            >
              {spec}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Doctor Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {doctors.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            No doctors found matching this specialty.
          </div>
        ) : (
          doctors.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <div className="w-24 h-24 bg-brand-secondary rounded-full mb-4 flex items-center justify-center text-brand-primary text-2xl font-bold">
                  {doc.user.name.split(' ').map(n => n[0]).join('')}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">{doc.user.name}</h3>
                <p className="text-sm font-medium text-brand-accent mb-2">{doc.specialization}</p>
                <p className="text-xs text-gray-500 mb-6">{doc.qualification}</p>
                
                <Link href={`/patient/book/${doc.id}`} className="w-full">
                  <Button variant="outline" className="w-full">
                    View Availability
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
