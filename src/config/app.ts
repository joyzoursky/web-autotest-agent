export const config = {
    app: {
        name: 'SkyTest Agent',
        locale: 'en-GB',
    },

    api: {
        endpoints: {
            PROJECTS: '/api/projects',
            TEST_CASES: '/api/test-cases',
            TEST_RUNS: '/api/test-runs',
            RUN_TEST: '/api/run-test',
        },
    },

    queue: {
        concurrency: 2,
        pollInterval: 500,
        logRetentionMs: 10000,
    },

    test: {
        maxDuration: 600,
        browser: {
            viewport: {
                width: 1280,
                height: 800,
            },
            timeout: 30000,
            args: [
                '--no-default-browser-check',
                '--no-first-run',
                '--disable-default-apps',
                '--password-store=basic',
                '--use-mock-keychain',
            ] as string[],
        },
        screenshot: {
            type: 'jpeg' as const,
            quality: 60,
        },
    },

    ui: {
        statusColors: {
            IDLE: 'bg-gray-100 text-gray-700',
            QUEUED: 'bg-blue-100 text-blue-700',
            RUNNING: 'bg-yellow-100 text-yellow-700',
            PASS: 'bg-green-100 text-green-700',
            FAIL: 'bg-red-100 text-red-700',
            CANCELLED: 'bg-gray-100 text-gray-700',
        },
        browserColors: [
            'bg-blue-500',
            'bg-green-500',
            'bg-purple-500',
            'bg-orange-500',
            'bg-pink-500',
            'bg-teal-500',
            'bg-indigo-500',
            'bg-yellow-500',
        ],
    },

    files: {
        uploadDir: './uploads',
        maxFileSize: 10 * 1024 * 1024,
        maxFilesPerTestCase: 20,
        allowedMimeTypes: [
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/json',
            'application/xml',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'application/zip',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ] as string[],
        allowedExtensions: [
            '.pdf', '.txt', '.csv', '.json', '.xml',
            '.jpg', '.jpeg', '.png', '.gif', '.webp',
            '.zip',
            '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        ] as string[],
    },
} as const;

export type Config = typeof config;
export type TestStatus = keyof typeof config.ui.statusColors;
