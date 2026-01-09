
import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // Params are async in Next.js 15+
) {
    const { id } = await params;

    // First check status in DB
    const testRun = await prisma.testRun.findUnique({
        where: { id },
        select: { status: true, result: true, logs: true }
    });

    if (!testRun) {
        return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
    }

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const encode = (data: any) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

            // If already finished, just send the result and close
            if (['PASS', 'FAIL', 'CANCELLED'].includes(testRun.status)) {
                controller.enqueue(encode({ type: 'status', status: testRun.status }));

                // Always send the full logs from 'result' if available. 
                // This fixes the issue where a user joins late and sees nothing because the queue buffer is gone.
                if (testRun.result) {
                    try {
                        const events = JSON.parse(testRun.result);
                        if (Array.isArray(events)) {
                            // Send all events at once or iterate? Iterate is safer for client parser
                            for (const event of events) {
                                controller.enqueue(encode(event));
                            }
                        }
                    } catch (e) {
                        // ignore parse error
                    }
                } else if (testRun.logs) {
                    // Fallback to 'logs' field if result is empty (legacy or different format)
                    try {
                        const logs = JSON.parse(testRun.logs);
                        if (Array.isArray(logs)) {
                            for (const event of logs) {
                                controller.enqueue(encode(event));
                            }
                        }
                    } catch (e) { }
                }

                controller.close();
                return;
            }

            // If RUNNING or QUEUED, poll the queue
            let lastIndex = 0;
            const pollInterval = setInterval(async () => {
                try {
                    // Check queue status
                    const status = queue.getStatus(id);

                    if (!status) {
                        // Queue doesn't know about it -> check DB again, maybe finished?
                        const freshRun = await prisma.testRun.findUnique({ where: { id }, select: { status: true, result: true } });
                        if (freshRun && ['PASS', 'FAIL', 'CANCELLED'].includes(freshRun.status)) {
                            clearInterval(pollInterval);
                            controller.enqueue(encode({ type: 'status', status: freshRun.status }));
                            controller.close();
                            return;
                        }

                        // If DB still says RUNNING/QUEUED but Queue has no record, it's a zombie (server restart).
                        // We should report this and stop the stream.
                        if (freshRun && ['RUNNING', 'QUEUED'].includes(freshRun.status)) {
                            console.warn(`Detected orphaned run ${id} in DB. Marking as FAILED.`);

                            // Fix the DB state
                            await prisma.testRun.update({
                                where: { id },
                                data: {
                                    status: 'FAIL',
                                    error: 'Test execution interrupted (Server restarted or proces lost)',
                                    completedAt: new Date()
                                }
                            });

                            clearInterval(pollInterval);
                            controller.enqueue(encode({
                                type: 'status',
                                status: 'FAIL',
                                error: 'Test execution interrupted (Server restarted or proces lost)'
                            }));
                            controller.close();
                            return;
                        }

                        // Verify if it is finished but we missed it? Logic above covers it.
                        // If we are here, it's weird. Just return.
                        return;
                    }

                    // Send status update
                    // controller.enqueue(encode({ type: 'status', status })); // Optional, might be spammy

                    // Get logs
                    const events = queue.getEvents(id);
                    if (events.length > lastIndex) {
                        const newEvents = events.slice(lastIndex);
                        for (const event of newEvents) {
                            controller.enqueue(encode(event));
                        }
                        lastIndex = events.length;
                    }

                } catch (e) {
                    console.error('Streaming error', e);
                    clearInterval(pollInterval);
                    controller.close();
                }
            }, 500); // Poll every 500ms

            // Cleanup on close
            return () => {
                clearInterval(pollInterval);
            };
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
