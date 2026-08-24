import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { BookingService } from '@/lib/patient/booking-service';

const prisma = new PrismaClient();
const bookingService = new BookingService(prisma);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');
  const date = searchParams.get('date'); // YYYY-MM-DD

  if (!doctorId || !date) {
    return NextResponse.json({ error: 'Missing doctorId or date' }, { status: 400 });
  }

  try {
    const slots = await bookingService.getAvailableSlots(doctorId, date);
    return NextResponse.json(slots);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, ...payload } = await request.json();

    if (action === 'hold') {
      // In a real app, patientId comes from session
      // Using Jane Smith's ID for demo: we can look it up or hardcode for now
      // Let's assume the client sends patientId for simplicity in this demo phase
      const { patientId, doctorId, slotId } = payload;
      const appointment = await bookingService.holdSlot(patientId, doctorId, slotId);
      return NextResponse.json(appointment);
    }

    if (action === 'confirm') {
      const { appointmentId, symptoms } = payload;
      const confirmed = await bookingService.confirmBooking(appointmentId, symptoms);
      return NextResponse.json(confirmed);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    if (error.message.includes('Hold expired') || error.message.includes('No longer available')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
