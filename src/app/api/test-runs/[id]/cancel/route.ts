import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                testCase: {
                    include: { project: { select: { userId: true } } }
                }
            }
        });

        if (!testRun) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (testRun.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await queue.cancel(id);

        return NextResponse.json({ success: true, id: testRun.id, status: testRun.status });
    } catch (error) {
        console.error('Failed to cancel test run:', error);
        return NextResponse.json({ error: 'Failed to cancel test run' }, { status: 500 });
    }
}
