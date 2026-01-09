
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Cancel in queue
        queue.cancel(id);

        // Double check DB status update if queue didn't handle it (redundant but safe)
        // queue.cancel updates DB, but we fetch updated state to return
        const testRun = await prisma.testRun.findUnique({
            where: { id }
        });

        return NextResponse.json(testRun);
    } catch (error) {
        console.error('Failed to cancel test run:', error);
        return NextResponse.json({ error: 'Failed to cancel test run' }, { status: 500 });
    }
}
