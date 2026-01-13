import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

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

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { status, result, error, testConfig } = body;

        if (!status) {
            return NextResponse.json({ error: 'Status is required' }, { status: 400 });
        }

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId: id,
                status,
                result: result ? JSON.stringify(result) : null,
                error,
                configurationSnapshot: testConfig ? JSON.stringify(testConfig) : null,
            },
        });

        return NextResponse.json(testRun);
    } catch (error) {
        console.error('Failed to record test run:', error);
        return NextResponse.json({ error: 'Failed to record test run' }, { status: 500 });
    }
}
