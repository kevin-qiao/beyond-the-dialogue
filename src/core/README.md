# `src/core` — domain and application

This layer holds the app's domain model and its use cases. It contains no I/O: every
side effect it needs — storage, files, the agent runtime, notifications, the clock —
arrives through an interface declared in `ports/` and is implemented by an adapter in
`src/main/adapters/`.

**The rule, in one paragraph.** `src/core` must not import `electron`, any `node:*`
builtin, or any DOM global. That is not a style preference: this directory is compiled
into the **main** target *and* the **renderer** target (`tsconfig.node.json` and
`tsconfig.web.json` both list `src/core/**/*.ts`), so a `node:fs` import breaks the
renderer bundle while a `document` reference breaks main. The build would catch one of
those and not the other, which is why the boundary is asserted mechanically in
`test/layering.test.ts` rather than left to review.

Layer order is `shared → core → main adapters → hosts`. `core` may import `shared`;
`shared` must not import `core`'s services. Hosts (the Electron window today, a web
front end later) implement the same client contract in `src/shared/ipc.ts` against the
same services, which is the whole reason orchestration lives here rather than in an IPC
handler.

## Layout

| Directory | Holds |
|---|---|
| `domain/` | Entities and pure rules — categories, destinations, finish behaviours, validation, grants, hashing |
| `services/` | Use cases — finish a task, move to My Day, enqueue pre-processing, edit types |
| `ports/` | Interfaces the services depend on. Interfaces only; no implementations |

If you are about to write `import * as fs from 'node:fs'` in here, the answer is a new
method on a port and an adapter under `src/main/adapters/`.
