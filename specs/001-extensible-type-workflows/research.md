# Phase 0 Research: Extensible Type Workflows

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Date**: 2026-09-12

This document records the technical decisions the plan rests on. Each entry states
the decision, why it was chosen, and what was rejected. Findings are grounded in the
existing codebase with file:line references, or in the installed dependency tree.

---

## R1. Where the host-agnostic core lives

**Decision**: Populate the already-reserved `src/core/` directory as the
environment-neutral domain and application layer. Move the type-engine rules and the
workflow orchestration currently embedded in the IPC handlers into it behind port
interfaces. Electron, the filesystem, and the database become adapters.

**Rationale**: `src/core/**/*.ts` is already listed in the `include` array of *both*
`tsconfig.node.json` and `tsconfig.web.json` — it has been there since the initial
scaffold commit (2026-08-29) and has never contained a file. The build already
anticipates a layer importable by the main process and the renderer alike, so this
costs no new module boundary. The portability audit confirms the move is small: only
three files import Electron anywhere (`src/main/index.ts`, `src/main/paths.ts`,
`src/preload/index.ts`), and the core modules already take `db` as an explicit
parameter rather than reading a module-level handle.

**Constraints this imposes**: `src/core/` MUST NOT import `electron`, `node:*`, or any
DOM global. Filesystem, database, and platform access arrive through injected ports.
`electron.vite.config.ts` bundles each target independently, so a stray `node:fs`
import in core would break the renderer bundle and a DOM reference would break main.

**Alternatives considered**:
- *A separate workspace package (`packages/core`)*: rejected. It adds a build step,
  workspace tooling, and a second `node_modules` for a codebase whose bundler already
  inlines shared source. The reserved directory achieves the same boundary at zero cost.
- *Leave logic in `src/main/` and rely on discipline*: rejected. The web-host requirement
  then has no compile-time enforcement, which is the failure mode this is meant to avoid.
- *Move everything into core immediately*: rejected as a big-bang rewrite. See R2.

---

## R2. How much to lift, and in what order

**Decision**: Lift only what this feature needs. Specifically: the type-engine rules
(effective type/kind resolution, input validation, pre-process hashing), the four finish
behaviours, destination resolution and confinement, and the plugin-grant model. Introduce
the port interfaces those require. Leave the remaining CRUD handlers wired directly,
moving them opportunistically rather than in one sweep.

**Rationale**: The audit identified roughly ten "fat" IPC handlers holding real workflow
logic — input validation and hash gating (`src/main/index.ts:202-255`), pre-process
enqueue (`:256-266`), My Day triggers (`:279-296`), finish gating (`:321-355`), chat
session ownership (`:412-427`). Those are exactly the ones this feature must change, so
lifting them is not extra work — it is work the feature already requires. The remaining
~21 handlers are thin pass-throughs to services that already take explicit parameters.

The constitution's governance section is explicit that complexity must be justified
against the simplest alternative that satisfies the requirement. A full rewrite satisfies
no requirement that this slice does not.

**Alternatives considered**:
- *Lift all 31 handlers now*: rejected as unjustified scope. Most have no bearing on
  destinations, finish behaviours, or grants.
- *Add a thin host-abstraction facade without moving code*: rejected. It would leave the
  domain logic mixed with Electron-free-but-host-specific orchestration, so the web-host
  path would still need the same extraction later.

---

## R3. Finish dispatch becomes four declared behaviours

**Decision**: Replace the kind-based finish branch with a declared `finishBehaviour` on
the type, one of four: `complete-only`, `file-as-is`, `polish-then-file`,
`deposit-then-curate`. Each is a strategy with an explicit input and output. The
existing Learning flow maps to `deposit-then-curate`; Meeting uses `polish-then-file`.

**Rationale**: Today the dispatch is a hardcoded comparison against one specific value —
`if (effectiveKind(d(), task) === 'learning')` at `src/main/index.ts:348` — with the
comment at `:345-347` recording that everything else completes locally. Adding a second
destination-bearing behaviour to an `if` that asks "is this learning?" is precisely the
shape Principle III forbids ("never through a hardcoded branch on a specific concrete
key") and Principle VI targets.

**Alternatives considered**:
- *Extend the kind comparison to `learning || meeting`*: rejected. It is the same defect
  with two cases, and it would need editing again for every future behaviour.
- *Make finish behaviour free-form per type*: rejected by the spec — FR-014 fixes the set
  at four, and the clarification session confirmed users select rather than compose.

---

## R4. Destinations become a declared, confined descriptor

**Decision**: A type declares a destination as structured data — a root selector plus a
relative subpath — not a raw absolute path. Resolution goes through a single generalized
function derived from the existing `resolveLearningNotePath` (`src/main/wiki/wiki.ts:121-132`),
which confines by computing `path.relative(root, abs)` and rejecting results that are
absolute or begin with `..`.

**Rationale**: The confinement logic already exists and is already relied upon — Finish
refuses to save when a learning-note path escapes the wiki (`src/main/index.ts:335-341`).
FR-006 requires that same guarantee for every destination. Generalizing one proven
function is safer than writing a second confinement check, because two implementations of
a security control drift.

**Safety invariants that MUST be carried over** (from the persistence audit):

| Invariant | Current location | Why it must survive |
|---|---|---|
| Confinement by `path.relative`, reject `..`/absolute | `wiki.ts:121-132` | FR-006; prevents writing outside the destination root |
| Create-only scaffolding | `wiki.ts:37-57` | Never overwrite or restructure a user's existing directory |
| Snapshot before mutating, diff after | `wiki.ts:198-215`, `:238-262` | Makes a write auditable and reversible |
| Agent `cwd` + tool allowlist bound to the root | `wiki/ingest.ts:45-51` | Keeps a confined agent inside the destination |

**A specific hazard found**: `listExistingWikiFiles` walks only `['wiki','learning-notes']`
(`src/main/wiki/wiki.ts:228`). A new destination directory is therefore **invisible to the
snapshot and diff** unless that loop is extended. Wiring a new destination without
touching it would silently disable the audit trail while still reporting success — a
worse outcome than failing.

**Alternatives considered**:
- *Store an absolute path per type*: rejected. It gives up the confinement guarantee that
  FR-006 requires and makes the destination unportable across machines.
- *Reuse `Settings.wikiPath` with a subfolder per type*: rejected. It forces every type into
  one root, which cannot express a plain meeting-minutes folder outside the wiki.

> *Addendum (2026-09)*: the second alternative's premise — a global wiki location — was later
> removed outright. The wiki directory is now a per-type `rootPath` (the first alternative, as
> shipped for folders since this feature itself), and the confinement concern is answered by the
> single `relative()`/`..` containment check applied at every write. A wiki-destined type with no
> root is refused at Finish (`wiki.notConfigured`).

---

## R5. Widening the set of behaviour categories

**Decision**: Add `meeting` as a fourth category. Migrate with a table rebuild of the
three tables carrying the task-kind check — `tasks` (`src/main/db.ts:40`), `task_types`
(`:59`), `task_preprocess` (`:87`) — using the v3 rebuild as the template
(`db.ts:383-428`) and the DDL-string detection gate (`db.ts:434-457`).

**Rationale**: SQLite cannot `ALTER` a `CHECK` constraint; the twelve-step table rebuild
is the only mechanism. Both patterns already exist in this file and are covered by a
regression test for the foreign-key hazard (`test/core.test.ts:187-190`) — dropping a
parent table with live child rows fails unless `PRAGMA foreign_keys = OFF` wraps the
swap, which the v3 step documents and handles.

**A correction to record**: the category list is hardcoded in **three tables**, appearing
as **four occurrences of the literal** (the fourth is the restated DDL inside the v3
rebuild at `db.ts:392`). An earlier statement in this project's history described it as
four tables; that was wrong — `enrichment_jobs.kind` (`db.ts:72`) constrains *job* kinds
(`preprocess|suggestion|ingest`), an unrelated axis.

**No migration is needed for the new built-in type itself.** `builtinTypeSeeds()`
(`db.ts:172-202`) is invoked outside every version gate at the tail of `migrate()`
(`:555-561`) and inserts with `INSERT OR IGNORE`, so pushing a Meeting seed into that
function inserts it on the next startup of an existing database. Only the category
widening needs a version step.

**Hazard**: `effectiveKind` falls back to `'plain'` (`src/main/types.ts:93-95`), so a new
category that misses a renderer or agent branch behaves like a plain task **silently**
rather than failing. This is the highest-risk silent-failure mode in the feature and
needs a dedicated test.

**Alternatives considered**:
- *Drop the `CHECK` constraints entirely and validate in code*: rejected. It trades a
  cheap database-level guarantee for a code-level one and still requires the same rebuild.
- *Model the category as data rather than a union*: rejected for this change. It is the
  more extensible end state, but it touches every exhaustive switch in main and renderer
  at once. Recorded as a candidate follow-up rather than bundled here.

---

## R6. Plugin grants are evaluated at one seam

**Decision**: Grants live on the type (`skills`, `toolServers` name lists) and are
evaluated in `createJobSession`/chat session construction — `src/main/ai/session-factory.ts:51-91`,
the location already documented as the intended landing spot (`:8-12`). Confined
operations (ingest, meeting polish, suggestions) receive an empty grant by construction,
not by convention.

**Rationale**: The SDK already provides the whole mechanism, so nothing needs inventing:

| Need | SDK facility |
|---|---|
| Restrict tools per session | `tools?: string[]` allowlist and `excludeTools` on `CreateAgentSessionOptions` |
| Inject tools directly | `customTools?: ToolDefinition[]` — already wired at `session-factory.ts:87` |
| Deny a call at runtime | the `tool_call` extension event returning `{ block: true, reason }` |
| Load skills | `loadSkills` / `loadSkillsFromDir` / `formatSkillsForPrompt` (Agent Skills standard) |

Skills require no custom loading — the SDK parses `SKILL.md` directories natively, and the
app already copies imported skill folders to `<userData>/skills` (`src/main/skills.ts:32-45`).

**Important limitation**: skill frontmatter `allowed-tools` is **not enforced** by the SDK
(zero references in the compiled output; the docs label it experimental). Skills therefore
cannot serve as a permission mechanism. Grants and skills are separate concerns.

**Alternatives considered**:
- *Enforce grants in the UI only*: rejected — the renderer is not a trust boundary.
- *Per-task grants rather than per-type*: rejected by FR-019, which scopes grants to types.

---

## R7. MCP via the community adapter, with an isolated config

**Decision**: Adopt the community package `pi-mcp-adapter` (MIT, npm `pi-mcp-adapter`,
version **pinned exactly** at 2.33.0) and drive it through its SDK entry point
`createMcpAdapter({ config })`, supplying an **isolated in-memory config** built from the
app's own `Settings.mcpServers`. No MCP protocol or transport code is written by this
project.

**Rationale**: The Pi SDK has no MCP support whatsoever — a deliberate product decision.
Its README states *"No MCP. Build CLI tools with READMEs (see Skills), or build an
extension that adds MCP support."* There is no MCP module in `dist/`, no MCP extension
among the 78 shipped examples, and no MCP dependency in the tree. So there was nothing to
enable; a package was the only route, and the user directed this one.

The decisive capability is isolation. The adapter's own documentation states that
supplied in-memory `createMcpAdapter({ config })` configurations **do not read or write**
the project or global override files and that its interactive commands are unavailable in
that mode. This satisfies the app's standing rule that all agent-runtime state stays
app-private under userData and never touches the user's `~/.pi`.

**Risks accepted, with mitigations:**

1. **Preview-registry dependencies (highest severity).** The adapter depends on
   `@modelcontextprotocol/client` and `@modelcontextprotocol/core` pinned to `pkg.pr.new`
   commit URLs, not published npm versions. Those artifacts are served by a third-party
   preview service, can be garbage-collected, and sit outside npm's provenance pipeline.
   *Mitigation*: treat installation as a gated verification step. The feature MUST NOT be
   considered complete until a clean `npm install` succeeds reproducibly on both target
   platforms and the resolved artifacts are recorded in the lockfile. If that fails, the
   plan's fallback is to defer the tool-server half (see R7a).
2. **Native modules.** `@napi-rs/keyring` (OS credential store) and
   `fs-native-extensions` require per-platform, per-ABI builds. *Mitigation*: verify the
   build on Windows and Linux before P4 is declared done; document the Linux secret-service
   requirement (`libsecret`) alongside the existing GTK/NSS/ALSA list in the README.
3. **A TUI peer dependency.** `@earendil-works/pi-tui` is a peer. The app never renders a
   terminal UI. *Mitigation*: confirm the peer is satisfiable without shipping a terminal
   renderer; if it forces one in, the adapter is unsuitable for a packaged GUI app.
4. **Credential surface.** The adapter supports OAuth via the OS credential store.
   *Mitigation*: the app restricts configuration to the transport form its Settings
   surface already supports, and no credential material may be written into the repository
   or into app settings.

**Alternatives considered**:
- *Write an MCP bridge ourselves*: rejected by explicit user direction.
- *Adopt the official `@modelcontextprotocol/sdk` behind a thin extension*: rejected — it
  still means authoring a Pi extension, which is the thing the direction excludes.
- *Defer MCP entirely*: not chosen, because a vetted community package exists; but retained
  as the fallback if the risks above cannot be cleared.

---

## R7a. Fallback if the adapter does not clear verification

**Decision**: If R7's risks cannot be cleared, ship the grant seam without MCP and defer
the tool-server half of FR-018 to a follow-up specification.

**Rationale**: Everything else in P4 is independently valuable and independently testable:
per-type grants, the tool allowlist, runtime denial via `tool_call`, confined sessions
receiving no grant, and native skill loading all work without any MCP transport. The
confinement guarantee (FR-020, SC-006) is buildable and testable today using a scripted
tool double. Only the live external read/write (FR-021, FR-022) needs the adapter.

**Consequence if invoked**: FR-018's tool-server clause becomes unbuilt and the spec must
be amended rather than silently left claiming it. This is recorded now so the gap is a
decision rather than a discovery.

### R7a — outcome (2026-09-12): the fallback IS invoked

**Decision: the tool-server half of FR-018 is deferred. The grant seam ships alone.**

The gates were evaluated against the published metadata of `pi-mcp-adapter@2.33.0` and
**T061 fails on its own stated criterion**.

| Gate | Result | Evidence |
|---|---|---|
| T061 — dependency reproducibility | **FAIL** | The package's own dependencies pin `@modelcontextprotocol/client` and `@modelcontextprotocol/core` to `https://pkg.pr.new/@modelcontextprotocol/…@3b205e7dd2f997b6a87e479e36421f7eaa2058e0` — **preview commit builds**, not published npm versions. R7 named this exact shape as disqualifying ("If this cannot be made reproducible, do not proceed"). |
| T062 — native modules on both platforms | **CANNOT VERIFY** | `@napi-rs/keyring` and `fs-native-extensions` are both native and present. Only Linux (WSL2) was available; the Windows half of the gate is unexercised. Per quickstart S9 an unrun platform is a recorded limitation, not an assumption — and a gate that cannot be run has not passed. |
| T063 — terminal-UI peer | **UNVERIFIED** | `@earendil-works/pi-tui@0.85.1` is published and would be auto-installed as a peer dependency. Whether it can be satisfied without shipping a terminal renderer into the GUI app was not established. |
| T064 — credential containment | **UNVERIFIED** | The adapter's OAuth path uses the OS credential store via `@napi-rs/keyring`. Containment could not be proven without installing the package; the presence of a keyring dependency means credential material would exist in-process and would need explicit demonstration. |

**Why the reachability result does not rescue T061.** The preview URLs *are* currently
reachable (HTTP 200, verified). That is not the question the gate asks. `pkg.pr.new`
artifacts are per-commit preview builds tied to a pull request: they are garbage-collected,
they are outside npm's provenance and integrity pipeline, and they are not what a lockfile
is supposed to pin. The same packages have ordinary published releases (`2.0.0`), which
makes the preview pin a choice rather than a necessity — and a choice that would put an
ephemeral third-party artifact into this project's dependency graph, whose `.npmrc` is
deliberately pointed at a mirror.

**What ships instead.** Everything in P4 except the transport, all of it independently
testable against a scripted tool double:

- Per-type grants declared on the type and resolved at the session-build seam (`resolveGrant`).
- Confined sessions receive `NO_GRANT` by construction (FR-020, SC-006) — proven in
  `test/grants.test.ts` across every confined purpose, including a deliberately
  misconfigured type.
- The egress boundary (FR-029, SC-010) enforced at context construction, proven in the
  same file and wired into the chat path.
- The propose/confirm split (FR-022, FR-023, SC-005): the mutator is structurally absent
  from the model's tool surface, and a failure is never reported as success (FR-024).
- Native skill loading through the SDK's `loadSkillsFromDir`, gated by the resolved grant.
- The full grants UI, distinguishing a skill from a tool server and stating the consequence.

**What is deferred.** Live external reads (FR-021) and live remote writes (FR-022's
transport) — the parts that need a real connection. They are deferred with the gate
evidence above, not abandoned: the seam, the confinement guarantee, and the confirmation
model are exactly the pieces the transport will plug into.

**Consequence, executed**: FR-018 is amended in `spec.md` to state plainly that the
tool-server half is not built in this version, and the spec's status notes it. The plan's
Complexity Tracking carries the same outcome. `test/mcpAdapter.test.ts` is added as a
regression guard for the isolation property that must hold *when* the adapter lands: no
global MCP config path is read or written, and nothing reaches `~/.pi`.

---

## R7b. The reproducibility gate clears — the transport is re-adopted

**Decision (2026-09-22, `add-mcp-support`)**: lift the R7a deferral. Adopt
`pi-mcp-adapter@2.35.0`, **pinned exactly**, driven through the same isolated in-memory
form R7 named non-negotiable: `createMcpAdapter({ config })`, the config built per session
from the type's granted servers.

**Why the deferral no longer holds.** R7a invoked the fallback on one disqualifying fact:
v2.33.0 pinned `@modelcontextprotocol/client` and `@modelcontextprotocol/core` to
`pkg.pr.new` preview-commit URLs. v2.35.0 pins both to **published npm `2.0.0`** with
ordinary provenance, and drops the `fs-native-extensions` native dependency entirely. T061
re-run: a clean install from this project's mirror resolves those artifacts and writes no
`pkg.pr.new` URL into the lockfile — and that is now asserted on every test run
(`test/mcpAdapter.test.ts` fails if either property regresses), so the gate cannot be
undone quietly by a future bump.

**Gates still open, recorded rather than assumed.**

- **T062 (native, both platforms): half-passed.** Only Linux (WSL2) is exercised here.
  `@napi-rs/keyring` is prebuilt (no compile step) and loads lazily — the isolated-config
  spike proved neither it nor `recheck` is touched at import — but it is a native `.node`
  that must be available to the packaged app (handled via asar-unpack of the package's
  platform binaries). Windows was NOT exercised; that half remains a limitation, not an
  assumption.
- **T063 (terminal-UI peer): satisfied without shipping a renderer.** The peer is pinned at
  the root purely to resolve; nothing imports `pi-tui`.
- **T064 (credential surface): unchanged posture.** The app never invokes OAuth/keyring
  code. Those live only inside user-pasted server config (`!` secret helpers, `auth`,
  `bearerTokenStore`) that the ADAPTER acts on at the user's own instruction — the same
  trust boundary the settings copy states: "a server you add runs with your permissions;
  the app never invokes it on its own." The isolated-config mode also disables the
  adapter's own interactive `/mcp` setup, so there is no ambient code path.

**The one place it plugs in, and what it does not claim.** The adapter is constructed at
the existing session-build seam (`src/main/ai/session-factory.ts`), fed by
`resolveGrant`, registered as an inline extension factory so it loads without opening the
SDK's ambient-extension discovery. A confined run gets NO_GRANT by construction and so
constructs nothing — the confinement guarantee is honored by the same mechanism that made
it provable during the deferral, now with a live transport behind it. Sessions are
disposed with `session_shutdown` emitted, because the adapter's child-process teardown
hangs off that event and `abort()` alone does not fire it.

**What this deliberately does not claim.** The per-change remote-write execution of
FR-022 still needs an out-of-model tool call the adapter's public SDK surface does not
expose, so the confirmation bar keeps reporting the deferral honestly rather than reaching
a system it cannot safely drive from there. And the app has no user-facing interactive
session yet, so the transport is proven at the seam and by a scripted harness, not a
screen. Both gaps are stated in FR-018/FR-021/FR-022's second amendments rather than left
as discoveries.

---

## R8. Remote changes are structurally un-makeable without confirmation

**Decision**: Remote-mutating operations are never exposed to the model as directly
callable tools. The model may only call a **proposal** tool; the application surfaces the
proposal and performs the actual remote call itself, outside the model loop, after the
user confirms.

**Rationale**: FR-023 requires a per-change confirmation immediately before execution.
Enforcing that with a prompt instruction ("always ask first") is unenforceable — a prompt
is a request, not a constraint, and the model may fail to honour it. Making the mutating
operation *unreachable* from the model's tool surface makes the requirement structural: an
agent cannot perform what it cannot call. This also gives SC-005 something inspectable —
there is no code path from a model tool call to a remote write.

**Alternatives considered**:
- *Runtime denial via the `tool_call` event*: rejected as the primary control. It is a
  useful second layer but it is reason-based and advisory; the structural separation does
  not depend on the model's cooperation.
- *Post-hoc audit of remote calls*: rejected. Detection after a change has been posted to
  a real ticket does not satisfy a confirmation requirement.

---

## R9. The data-egress boundary must be enforced at context construction

**Decision**: The session-context builder becomes grant-aware. When a type has any tool
grant, the working content — notes, minutes, drafts — is excluded from the context handed
to the model. The task's declared inputs and the user's request remain.

**Rationale**: FR-029 requires that notes, minutes, drafts, the note store, the wiki, and
other tasks are never transmitted externally. Transmitting is determined by what the model
can *see*, and today `buildChatContext` (`src/main/index.ts:72-92`) deliberately includes
the current note for learning and the pasted source for JIRA. Once a session can reach an
external tool, that same context can be sent onward. Filtering at the tool boundary is too
late — the content is already in the prompt. The only correct enforcement point is
construction.

**Consequence to state plainly**: this makes a granted session less contextually rich than
an ungranted one. That is the intended trade: the user chose to grant external reach, so
the session sees less of their private material.

**Alternatives considered**:
- *Redact content just before a tool call*: rejected. The model has already reasoned over
  the full context and can echo it into the request body.
- *Warn the user once per grant*: rejected as insufficient for SC-010, which is stated as
  an absolute.

---

## R10. The transport contract becomes typed

**Decision**: Replace the untyped broadcast (`src/main/index.ts:121-125`, whose first
parameter is `string`) with a typed event map shared in `src/shared`, and reshape the
client contract so a second host can implement it.

**Rationale**: The renderer is already portable — it imports nothing from `src/main` and
depends solely on the `RendererApi` interface (`src/shared/ipc.ts:137-184`) exposed through
`window.api`. Swapping preload for an HTTP or WebSocket client is genuinely small. What is
missing is compile-time checking on the emit side: event payload shapes are only asserted
where they are constructed, so a second transport could silently disagree with the first.
The web-host requirement makes that gap load-bearing rather than theoretical.

**Alternatives considered**:
- *Keep the string-typed broadcast and rely on tests*: rejected. Tests cover known events;
  the contract's value is catching the unknown ones.
- *Full RPC framework*: rejected as unjustified. The existing request/event split is sound.

---

## R11. Test strategy

**Decision**: Extend the established seams rather than introduce a new harness. Add a
scripted session that *proposes* a remote change, a conformance test that asserts confined
sessions never receive a grant, and a negative test that an unrecognised category fails
loudly.

**Rationale**: `test/e2e.test.ts` already drives a full learning flow with `setUserDataRoot`
(`:92`, `:186`) and `setSessionFactory`/`setSimplePromptOverride` (`:54`, `:58`) — no
Electron, no network, no API key. The eleven existing test files already cover the areas
this feature touches. New behaviour plugs into the same pattern.

**Two regression boundaries to pin explicitly:**
- SC-003: the existing learning tests must pass **unmodified**. Any edit to them weakens
  the proof that `deposit-then-curate` still behaves identically.
- The silent-plain-fallback hazard from R5: add a test that a Meeting task routes to the
  meeting working area and the meeting pre-process, so a missing branch fails rather than
  quietly behaving like a plain task.

**Alternatives considered**:
- *Introduce a new test framework*: rejected. The headless `node:test` + `tsx` setup is
  already the constitution's requirement and is met.
