import { prisma } from '@/lib/prisma';
import { runTest } from './test-runner';
import { TestEvent } from '@/types';

interface Job {
    runId: string;
    config: any;
    controller: AbortController;
}

export class TestQueue {
    private static instance: TestQueue;
    private queue: Job[] = [];
    private running: Map<string, Job> = new Map();
    private concurrency = 2; // Default concurrency
    private logs: Map<string, TestEvent[]> = new Map();

    private constructor() { }

    public static getInstance(): TestQueue {
        if (!TestQueue.instance) {
            TestQueue.instance = new TestQueue();
        }
        return TestQueue.instance;
    }

    public async add(runId: string, config: any) {
        const controller = new AbortController();
        const job: Job = { runId, config, controller };

        // Push to queue
        this.queue.push(job);

        // Initialize log buffer for this run
        this.logs.set(runId, []);

        // Update DB
        try {
            await prisma.testRun.update({
                where: { id: runId },
                data: { status: 'QUEUED' }
            });
        } catch (e) {
            console.error(`Failed to update status for ${runId}`, e);
        }

        // Try to process
        this.processNext();
    }

    public async cancel(runId: string) {
        // Check running
        if (this.running.has(runId)) {
            const job = this.running.get(runId)!;

            // 1. Abort execution
            job.controller.abort();
            this.running.delete(runId);

            // 2. Immediately mark as CANCELLED in DB so UI updates instanly.
            // also Save logs collected so far!
            const logBuffer = this.logs.get(runId) || [];
            try {
                await prisma.testRun.update({
                    where: { id: runId },
                    data: {
                        status: 'CANCELLED',
                        error: 'Test stopped by user',
                        completedAt: new Date(),
                        result: JSON.stringify(logBuffer),
                        logs: JSON.stringify(logBuffer)
                    }
                });
            } catch (e) {
                console.error(`Failed to mark ${runId} as cancelled`, e);
            }

        } else {
            // Check queue
            const index = this.queue.findIndex(j => j.runId === runId);
            if (index !== -1) {
                this.queue.splice(index, 1);
                // Update DB since it never ran
                prisma.testRun.update({
                    where: { id: runId },
                    data: { status: 'CANCELLED', error: 'Cancelled while queued', completedAt: new Date() }
                }).catch(console.error);

                // Clear logs
                this.logs.delete(runId);
            } else {
                // Not in running, not in queue.
                // Could be finished, OR could be a 'zombie' run (server restarted while DB says RUNNING).
                // Or simply the ID is wrong.
                // We should force update DB to CANCELLED if it looks active in DB, just to be safe.
                prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } })
                    .then(run => {
                        if (run && ['RUNNING', 'QUEUED'].includes(run.status)) {
                            return prisma.testRun.update({
                                where: { id: runId },
                                data: { status: 'CANCELLED', error: 'Force cancelled (orphaned run)', completedAt: new Date() }
                            });
                        }
                    })
                    .catch(e => console.error(`Failed to cleanup orphaned run ${runId}`, e));
            }
        }
    }

    public getEvents(runId: string): TestEvent[] {
        return this.logs.get(runId) || [];
    }

    public getStatus(runId: string) {
        if (this.running.has(runId)) return 'RUNNING';
        const inQueue = this.queue.find(j => j.runId === runId);
        if (inQueue) return 'QUEUED';
        return null; // likely finished or unknown
    }

    private async processNext() {
        if (this.running.size >= this.concurrency) return;

        const job = this.queue.shift();
        if (!job) return;

        this.running.set(job.runId, job);

        // Update DB to RUNNING
        await prisma.testRun.update({
            where: { id: job.runId },
            data: {
                status: 'RUNNING',
                startedAt: new Date()
            }
        });

        // Run async without awaiting completion (fire and forget)
        this.executeJob(job);

        // Try to schedule more if we have capacity
        this.processNext();
    }

    private async executeJob(job: Job) {
        const { runId, config, controller } = job;
        const logBuffer = this.logs.get(runId) || [];

        try {
            const result = await runTest({
                runId,
                config,
                signal: controller.signal,
                onEvent: (event) => {
                    logBuffer.push(event);
                    // We could stream to DB here if needed, but for now memory buffer + final save
                }
            });

            // Finished
            await prisma.testRun.update({
                where: { id: runId },
                data: {
                    status: result.status,
                    error: result.error,
                    result: JSON.stringify(logBuffer), // Saving full events as result
                    logs: JSON.stringify(logBuffer), // Redundant but follows schema
                    completedAt: new Date()
                }
            });

        } catch (err) {
            console.error(`Unexpected error in job ${runId}`, err);

            // Check if it was already cancelled (which might cause the error)
            const current = await prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } });
            if (current?.status !== 'CANCELLED') {
                await prisma.testRun.update({
                    where: { id: runId },
                    data: {
                        status: 'FAIL',
                        error: String(err),
                        completedAt: new Date()
                    }
                });
            }
        } finally {
            this.running.delete(runId);
            // Wait a bit before clearing memory logs to allow pollers to fetch final state?
            // Actually, once saved to DB, pollers should read from DB.
            // We can keep it for a short while or trust the DB.
            // For safety, let's keep it for a specific window or let the next query which finds it in DB clear it?
            // Simpler: Just delete it. The API route should check DB if not in queue/running.
            setTimeout(() => {
                this.logs.delete(runId);
            }, 10000); // 10s buffer

            this.processNext();
        }
    }
}

// Global invocation (Next.js serverless considerations: this singleton works in dev/prod on standard Node runtime, 
// strictly serverless runtimes might lose state, but for "agent" type app usually it's persistent container or long-running)
export const queue = TestQueue.getInstance();
