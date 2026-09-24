# Contract: Layering and the Host-Agnostic Client

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Consumers**: every layer. This is the structural contract the other contracts assume.

The architecture must be layered, extensible, and driven by more than one host — a desktop
window today, potentially a web page for the same purpose later. This document defines the
boundaries that make that a build-time property rather than a hope.

---

## 1. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Hosts (interchangeable)                                      │
│   Electron window (today)          Web page (future)         │
│   ─ preload/IPC transport           ─ HTTP/WebSocket transport│
└───────────────────────────┬──────────────────────────────────┘
                            │ implements the client contract
┌───────────────────────────▼──────────────────────────────────┐
│ src/shared — the contract                                    │
│   domain types, command/event names, RendererApi-equivalent  │
│   Pure types and constants. Zero runtime dependencies.       │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ src/core — domain + application                              │
│   domain/   entities, type-engine rules, finish behaviours,   │
│             destination model, grant model, validation        │
│   services/ use cases (finish, my-day, preprocess, types)     │
│   ports/    interfaces the services depend on                 │
│   NO electron · NO node:* · NO DOM                            │
└───────────────────────────┬──────────────────────────────────┘
                            │ implemented by
┌───────────────────────────▼──────────────────────────────────┐
│ src/main — adapters + composition                            │
│   adapters/  sqlite store, artifact stores (wiki/folder),     │
│              pi agent runtime, MCP adapter, notifier, clock   │
│   index.ts   composition root: build adapters, build services,│
│              register the transport                           │
│   transport/ maps host messages → service calls + events      │
└──────────────────────────────────────────────────────────────┘
```

`src/core/` is not a new invention. `src/core/**/*.ts` is already in the `include` array of
**both** `tsconfig.node.json` and `tsconfig.web.json`, and has been since the initial
scaffold commit. The build already expects a layer importable by main and renderer alike;
this contract fills it.

---

## 2. Layering rules (enforceable)

| Rule | Why | How it fails today |
|---|---|---|
| `src/core/` imports no `electron`, no `node:*`, no DOM global | It is bundled into the main target *and* the renderer target | A `node:fs` import breaks the renderer bundle; a DOM reference breaks main |
| `src/core/` performs no I/O directly | All I/O arrives through a port | Otherwise the web host cannot substitute storage |
| `src/main/adapters/` is the only place platform APIs are touched | Platform divergence stays auditable in one place | Constitution Principle I; today only 3 files import Electron, keep it that way |
| `src/renderer/` imports nothing from `src/main` | The UI must not depend on a host | **Already true** — the renderer imports only `src/shared` |
| Agent-runtime SDK usage stays behind its adapter | One place absorbs SDK upgrades | Already enforced for the Pi SDK; the MCP adapter joins it |
| No hardcoded dispatch on a concrete category | Principle III | The finish branch at `index.ts:348` is the live example being removed |

---

## 3. The client contract

Two channels, both typed end to end.

```ts
// src/shared — commands: request/response
interface AppCommands {
  getSnapshot(): Promise<AppSnapshot>
  createTask(args: CreateTaskArgs): Promise<Task>
  updateTask(args: UpdateTaskArgs): Promise<Task>
  finishTask(args: { id: string }): Promise<Task>
  saveType(args: { def: TaskTypeDef }): Promise<TaskTypeDef>
  saveSettings(args: { settings: Settings }): Promise<Settings>
  sendChat(args: SendChatArgs): Promise<void>
  confirmRemoteChange(args: { proposalId: string }): Promise<RemoteOutcome>
  // ...
}

// src/shared — events: host → client, pushed
interface AppEvents {
  taskUpdated: Task
  suggestionsUpdated: { taskId: string; suggestions: Suggestion[] }
  jobProgress: JobProgressEvent
  ingestProgress: IngestProgressEvent
  openTask: { taskId: string }
  toast: ToastPayload
  // Chat events name the surface they belong to — `{ owner: string | null }`,
  // the owning task id or null for the debug chat. Transcripts are per-surface,
  // so a host that drops the owner streams one task's reply into another
  // task's panel.
  chatDelta: ChatDeltaEvent
  chatDone: ChatDoneEvent
  chatError: ChatErrorEvent
  // ...
}

type ClientContract = {
  [K in keyof AppCommands]: AppCommands[K]
} & {
  on<K extends keyof AppEvents>(event: K, handler: (payload: AppEvents[K]) => void): () => void
}
```

**Two changes from today's shape:**
1. **Events become typed.** Today `broadcast` takes `event: string, payload: unknown`
   (`src/main/index.ts:121-125`) and payload shapes are asserted only where they are
   constructed. Type safety exists only at the preload boundary. A second host could
   silently disagree with the first about a payload — exactly the failure the web-host
   requirement makes load-bearing.
2. **Commands are named once.** Channel names already live in one place
   (`src/shared/ipc.ts:6-55`); the contract keeps that property and adds payload types
   keyed by name so an implementation cannot satisfy a name with the wrong shape.

---

## 4. Host implementations

| Host | Commands | Events | Status |
|---|---|---|---|
| Electron | preload `ipcRenderer.invoke` | `webContents.send` → `ipcRenderer.on` | today; exists at `src/preload/index.ts` |
| Web | `fetch`/WebSocket client implementing the same interface | server push over the same socket | future; nothing in the renderer changes |

The renderer is already portable in source terms — it knows only the interface, reaches it
through `window.api`, and imports nothing from `src/main` (verified: its only imports are
`src/shared/ipc` and `src/shared/types`). Substituting an HTTP client for the preload
bridge is small; the point of this contract is to keep it small.

**Not in scope for this feature**: building the web host. The deliverable is that the
boundaries make one possible without moving domain logic again. Anything that would have to
be rewritten to move a second host in is a defect in this layering, not future work.

---

## 5. Composition root obligations

`src/main/index.ts` currently holds both the Electron shell *and* the application's
singleton state and workflow orchestration: `let db`, `mainWindow`, `queue`, `chatSessions`
(one conversation per chat surface), `alarms` (`:39-46`), with roughly ten handlers carrying
real logic
(`:202-255`, `:256-266`, `:279-296`, `:321-355`, `:397-427`).

After this change the composition root does exactly three things:

1. Resolve the user data root and construct the adapters.
2. Construct the services from those adapters.
3. Register the transport, mapping each command to a service call and each service event to
   a typed event.

It owns no workflow logic and no domain rules. A second host repeats those three steps with
a different transport — that is the whole test of whether this layering holds.

**Known duplication to resolve while here**: the database path is computed in two places —
`openDB` joins `dataDir/app.db` (`src/main/db.ts:343`) while `paths.appDbPath()` computes
the same value independently (`src/main/paths.ts:20`), and `index.ts:466` passes the
Electron path in directly, bypassing the portability seam. Constitution Principle VI
applies: one declaration, consumed from there.
