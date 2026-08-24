import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { LeaveService } from '@/lib/admin/leave-service';
import { JobQueue } from '@/jobs/queue';

const prisma = new PrismaClient();
const queue = new JobQueue(prisma);
const leaveService = new LeaveService(prisma, queue);

export async function POST(request: Request) {
  try {
    const { leaveId, action } = await request.json();
    
    if (!leaveId || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (action === 'APPROVE') {
      const leave = await leaveService.approveLeave(leaveId);
      return NextResponse.json(leave);
    } else {
      const leave = await leaveService.rejectLeave(leaveId);
      return NextResponse.json(leave);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
