import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const config = await request.json();
    const { url, prompt, steps, browserConfig, testCaseId } = config;

    // Validation
    const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;
    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasBrowserConfig && !url) {
        return NextResponse.json(
            { error: 'Valid configuration (URL or BrowserConfig) is required' },
            { status: 400 }
        );
    }

    if (!hasSteps && !hasPrompt) {
        return NextResponse.json(
            { error: 'Instructions (Prompt or Steps) are required' },
            { status: 400 }
        );
    }

    try {
        // Create TestRun record
        // If we have a testCaseId, link it. If not, we might need a "detached" run or require testCaseId.
        // The previous code had "activeTestCaseId" in the frontend. 
        // If the user runs a generic "new run", the frontend usually creates a test case first.
        // Let's assume testCaseId is provided. If not, we might fail or create a temp one?
        // Schema says `testCaseId` is required on `TestRun`.

        if (!testCaseId) {
            return NextResponse.json(
                { error: 'TestCase ID is required for background execution' },
                { status: 400 }
            );
        }

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId,
                status: 'QUEUED',
                configurationSnapshot: JSON.stringify(config) // Save config snapshot
            }
        });

        // Add to Queue
        await queue.add(testRun.id, config);

        return NextResponse.json({ runId: testRun.id });

    } catch (error) {
        console.error('Failed to submit test job:', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}
