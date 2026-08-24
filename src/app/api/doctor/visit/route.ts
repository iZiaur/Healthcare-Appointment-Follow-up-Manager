import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { VisitService } from '@/lib/doctor/visit-service';
import { JobQueue } from '@/jobs/queue';

const prisma = new PrismaClient();
const queue = new JobQueue(prisma);
const visitService = new VisitService(prisma, queue);

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { appointmentId, doctorNotes, prescription } = payload;
    
    if (!appointmentId || !doctorNotes) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const appointment = await visitService.completeVisit(appointmentId, doctorNotes, prescription);
    
    return NextResponse.json(appointment);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
