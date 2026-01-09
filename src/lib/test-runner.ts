
import { chromium, Page, BrowserContext } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { TestStep, BrowserConfig, TestEvent } from '@/types';

export const maxDuration = 600; // 10 minutes timeout

type EventHandler = (event: TestEvent) => void;

interface RunTestOptions {
    runId: string;
    config: {
        url: string;
        username?: string;
        password?: string;
        prompt: string;
        steps?: TestStep[];
        browserConfig?: Record<string, BrowserConfig>;
    };
    onEvent: EventHandler;
    signal?: AbortSignal;
}

export async function runTest(options: RunTestOptions): Promise<{ status: 'PASS' | 'FAIL' | 'CANCELLED'; error?: string }> {
    const { config, onEvent, signal, runId } = options;
    const { url, username, password, prompt, steps, browserConfig } = config;

    // Helper to send log
    const log = (msg: string, type: 'info' | 'error' | 'success' = 'info', browserId?: string) => {
        onEvent({
            type: 'log',
            data: { message: msg, level: type },
            browserId,
            timestamp: Date.now()
        });
    };

    // Helper to send screenshot
    const sendScreenshot = async (p: Page, label: string, browserId?: string) => {
        try {
            if (p.isClosed()) return;
            const buffer = await p.screenshot({ type: 'jpeg', quality: 60 });
            const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            onEvent({
                type: 'screenshot',
                data: { src: base64, label },
                browserId,
                timestamp: Date.now()
            });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log(`Failed to capture screenshot: ${errMsg}`, 'error', browserId);
        }
    };

    // Configuration logic
    let targetConfigs: Record<string, BrowserConfig> = {};
    if (browserConfig && Object.keys(browserConfig).length > 0) {
        targetConfigs = browserConfig;
    } else if (url) {
        targetConfigs = { 'main': { url, username, password } };
    } else {
        throw new Error('Valid configuration (URL or BrowserConfig) is required');
    }

    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasSteps && !hasPrompt) {
        throw new Error('Instructions (Prompt or Steps) are required');
    }

    let browser: any;
    const contexts = new Map<string, BrowserContext>();
    const pages = new Map<string, Page>();
    const agents = new Map<string, PlaywrightAgent>();

    try {
        log('Launching browser...', 'info');
        browser = await chromium.launch({
            headless: true,
            timeout: 30000,
            args: [
                '--no-default-browser-check',
                '--no-first-run',
                '--disable-default-apps',
                '--password-store=basic',
                '--use-mock-keychain',
            ]
        });
        log('Browser launched successfully', 'success');

        // Initialize all requested browsers
        const browserIds = Object.keys(targetConfigs);

        for (const browserId of browserIds) {
            if (signal?.aborted) break;

            const config = targetConfigs[browserId];
            const niceName = browserId === 'main' ? 'Browser' :
                browserId.replace('browser_', 'Browser ').toUpperCase();

            log(`Initializing ${niceName}...`, 'info', browserId);

            const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

            const p = await context.newPage();
            p.on('console', async (msg: any) => {
                const type = msg.type();
                if (type === 'log' || type === 'info') {
                    if (!msg.text().includes('[midscene]')) {
                        log(`[${niceName}] ${msg.text()}`, 'info', browserId);
                    }
                } else if (type === 'error') {
                    log(`[${niceName} Error] ${msg.text()}`, 'error', browserId);
                }
            });
            const page = p;

            contexts.set(browserId, context);
            pages.set(browserId, page);

            // Navigation
            if (config.url) {
                log(`[${niceName}] Navigating to ${config.url}...`, 'info', browserId);
                await page.goto(config.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
                await sendScreenshot(page, `[${niceName}] Initial Page Load`, browserId);
            }

            // Agent
            const agent = new PlaywrightAgent(page, {
                onTaskStartTip: async (tip) => {
                    log(`[${niceName}] 🤖 ${tip}`, 'info', browserId);
                    if (page && !page.isClosed()) await sendScreenshot(page, `[${niceName}] ${tip}`, browserId);
                }
            });
            agents.set(browserId, agent);
        }

        log('All browser instances ready', 'success');
        log('Executing test...', 'info');

        if (signal?.aborted) throw new Error('Aborted');

        if (hasSteps) {
            for (let i = 0; i < steps.length; i++) {
                if (signal?.aborted) throw new Error('Aborted');

                const step: TestStep = steps[i];
                const targetId = step.target;
                const effectiveTargetId = targetId || browserIds[0];

                const agent = agents.get(effectiveTargetId);
                const page = pages.get(effectiveTargetId);
                const config = targetConfigs[effectiveTargetId];
                const niceName = effectiveTargetId === 'main' ? 'Browser' :
                    effectiveTargetId.replace('browser_', 'Browser ').toUpperCase();

                if (!agent || !page) {
                    throw new Error(`Browser instance '${effectiveTargetId}' not found for step: ${step.action}`);
                }

                log(`[Step ${i + 1}] Executing on ${niceName}: ${step.action}`, 'info', effectiveTargetId);

                let stepAction = step.action;
                if (config && (config.username || config.password)) {
                    stepAction += `\n(Credentials: ${config.username} / ${config.password})`;
                }

                await agent.aiAct(stepAction);
                await sendScreenshot(page, `[${niceName}] Step ${i + 1} Complete`, effectiveTargetId);
            }
        } else {
            const targetId = browserIds[0];
            const agent = agents.get(targetId);
            const config = targetConfigs[targetId];

            if (!agent) throw new Error('No browser agent available');

            let fullPrompt = prompt;
            if (config.username || config.password) {
                fullPrompt += `\n\nCredentials if needed:\nUsername: ${config.username}\nPassword: ${config.password}`;
            }

            await agent.aiAct(fullPrompt);
        }

        if (signal?.aborted) throw new Error('Aborted');

        log('✅ Test executed successfully', 'success');

        // Final Screenshots
        for (const [id, page] of pages) {
            if (signal?.aborted) break;
            const niceName = id === 'main' ? 'Browser' : id.replace('browser_', 'Browser ').toUpperCase();
            if (!page.isClosed()) await sendScreenshot(page, `[${niceName}] Final State`, id);
        }

        return { status: 'PASS' };

    } catch (error: unknown) {
        if (signal?.aborted || (error instanceof Error && error.message === 'Aborted')) {
            return { status: 'CANCELLED', error: 'Test was cancelled by user' };
        }

        const msg = error instanceof Error ? error.message : String(error);
        log(`Critical System Error: ${msg}`, 'error');

        // Capture error state
        try {
            for (const [id, page] of pages) {
                if (!page.isClosed()) await sendScreenshot(page, `Error State [${id}]`, id);
            }
        } catch (e) {
            console.error('Failed to capture error screenshot', e);
        }

        return { status: 'FAIL', error: msg };

    } finally {
        try {
            if (browser) await browser.close();
        } catch (e) {
            console.error('Error closing browser:', e);
        }
    }
}
