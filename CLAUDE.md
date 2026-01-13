# SkyTest Agent - AI Coding Guidelines

## Project Map (Read This First)

```
src/
├── lib/                    # Core singletons - START HERE for backend logic
│   ├── queue.ts            # Job queue (singleton) - test execution scheduling
│   ├── test-runner.ts      # Playwright/Midscene execution engine
│   ├── prisma.ts           # Database client (singleton)
│   ├── usage.ts            # API usage tracking
│   └── auth.ts             # Authentication helpers
│
├── app/                    # Next.js App Router
│   ├── api/                # API Routes
│   │   ├── test-runs/[id]/ # SSE events, cancel, status
│   │   ├── test-cases/[id]/# CRUD + run trigger
│   │   └── projects/       # Project management
│   ├── projects/           # UI: Project list & detail pages
│   ├── test-cases/[id]/    # UI: Test case history views
│   └── page.tsx            # Home page
│
├── components/             # React components
│   ├── BuilderForm.tsx     # Main test case editor
│   ├── ResultViewer.tsx    # Test result display
│   └── result-viewer/      # Result sub-components
│
├── types/                  # TypeScript interfaces
│   └── index.ts            # All type exports (read this first)
│
└── config/app.ts           # App configuration (never hardcode values)
```

## Task Routing (Find Files Fast)

| Task | Start Here | Related Files |
|------|------------|---------------|
| Fix test execution | `src/lib/test-runner.ts` | `queue.ts`, `api/test-cases/[id]/run/` |
| Fix queue/scheduling | `src/lib/queue.ts` | `test-runner.ts` |
| Fix SSE/real-time | `src/app/api/test-runs/[id]/events/` | `ResultViewer.tsx` |
| Fix test case CRUD | `src/app/api/test-cases/` | `types/test.ts` |
| Fix UI components | `src/components/` | Check component name |
| Add new API endpoint | `src/app/api/` | `types/`, `lib/prisma.ts` |
| Change DB schema | `prisma/schema.prisma` | `types/database.ts` |

## Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, TailwindCSS 4
- **Backend**: Next.js API Routes, Prisma (SQLite), SSE
- **Engine**: Playwright 1.57, Midscene.js (AI Automation)

## Core Patterns
1. **Strict Types**: No `any`. All types in `src/types/index.ts`.
2. **Singletons**: Use `lib/prisma.ts` and `lib/queue.ts`. Never create new instances.
3. **Config**: Never hardcode. Use `src/config/app.ts`.
4. **API Routes**: Wrap in `try-catch`, return `NextResponse.json`.

## Code Style
**Code as Documentation**: Write self-explanatory code. Avoid comments unless absolutely necessary.
- Good variable/function names eliminate need for comments
- Only add comments for non-obvious "why" (not "what")
- Never comment obvious code like `// loop through items` or `// validate input`

## Commands
- `npm run dev` - Start dev server
- `npx prisma studio` - Open DB GUI
- `npx prisma db push` - Push schema changes

## Common Patterns (Copy-Paste Ready)

### Adding a New API Endpoint
```typescript
// src/app/api/[resource]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // 1. Fetch data with ownership check
        const data = await prisma.project.findMany({
            where: { userId: authPayload.userId }
        });

        return NextResponse.json(data);
    } catch (error) {
        console.error('Failed to fetch:', error);
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
}
```

### Ownership Check Pattern (for nested resources)
```typescript
// Verify user owns the resource through the chain: testRun -> testCase -> project -> user
const testRun = await prisma.testRun.findUnique({
    where: { id },
    include: {
        testCase: {
            include: { project: { select: { userId: true } } }
        }
    }
});

if (!testRun) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

if (testRun.testCase.project.userId !== authPayload.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

### Adding Pagination
```typescript
const url = new URL(request.url);
const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
const skip = (page - 1) * limit;

const [data, total] = await Promise.all([
    prisma.testRun.findMany({ where, orderBy, skip, take: limit }),
    prisma.testRun.count({ where })
]);

return NextResponse.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
});
```

### Adding a Database Field
1. Update `prisma/schema.prisma`
2. Run `npx prisma db push`
3. Update types in `src/types/` if needed
4. Re-export from `src/types/index.ts`

## Security Checklist
- [ ] `verifyAuth(request)` called at route start
- [ ] Ownership verified: `resource.project.userId === authPayload.userId`
- [ ] Input validated before database operations
- [ ] Sensitive fields not exposed in responses
