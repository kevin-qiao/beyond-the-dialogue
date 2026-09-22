# Contract: Plugin Grants, Confinement, and Remote Actions

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Consumers**: the session factory, the chat path, the confined job paths, the settings UI.

This contract concentrates the highest-risk behaviour in the feature: it is where the
application deliberately opens an agent session to systems outside the machine.

---

## 1. Grant shape

```ts
interface PluginGrant {
  skills: string[]        // names of registered skills
  toolServers: string[]   // names of registered tool servers
}

const NO_GRANT: PluginGrant = { skills: [], toolServers: [] }
```

Declared on the type, not on the task (FR-019). Evaluated in exactly one place.

---

## 2. The evaluation seam

Grants are resolved when a session is built, in `createJobSession` /
`src/main/ai/session-factory.ts:51-91` — the location the code already documents as the
intended landing spot (`:8-12`).

```ts
interface SessionBuildRequest {
  purpose: 'interactive' | 'confined'
  typeDef?: TaskTypeDef
  // ...
}

function resolveGrant(req: SessionBuildRequest): PluginGrant {
  if (req.purpose === 'confined') return NO_GRANT   // by construction
  return req.typeDef?.grants ?? NO_GRANT
}
```

**`confined` is a property of the call site, not of the caller's intent.** The three
confined purposes are material ingestion, minute polishing, and suggestion generation. A
confined build returns `NO_GRANT` unconditionally — there is no code path that yields a
grant for them (FR-020, SC-006). This is the whole reason for the function: the guarantee
is architectural, so it holds even if a type is misconfigured or a future caller is
careless.

### SDK facilities this maps onto

Nothing here needs inventing; the agent SDK already provides each part:

| Need | Facility | Where |
|---|---|---|
| Restrict the tool surface | `tools?: string[]` allowlist, `excludeTools` | `CreateAgentSessionOptions` |
| Inject tools directly | `customTools?: ToolDefinition[]` | already wired at `session-factory.ts:87` |
| Deny a call at runtime | the `tool_call` event returning `{ block: true, reason }` | extension hook |
| Load skills | `loadSkills` / `loadSkillsFromDir` | Agent Skills standard; already copied to `<userData>/skills` by `src/main/skills.ts:32-45` |

**Skills are not permissions.** The SDK does not enforce skill frontmatter `allowed-tools`
(no references in its compiled output; its docs label the field experimental). A skill
confers capability, never authority. Grants and skills are separate concerns and must not
be conflated in the UI.

---

## 3. The egress boundary (FR-029, SC-010)

**Rule**: when a type has any grant, the session context includes only the task's declared
inputs and the user's request. The user's working content — notes, minutes, drafts — and
the note store, the wiki, and other tasks are excluded.

**Why this is enforced at context construction, not at the tool boundary.** Transmitting is
determined by what the model can *see*. Today's context builder deliberately includes the
current note for learning tasks and the pasted source for JIRA (`src/main/index.ts:72-92`).
Once a session can reach an external tool, that same context can be echoed onward — so
filtering at the call site is too late. The content is already in the prompt.

```ts
function buildContext(task, typeDef, purpose): string | undefined {
  const granted = hasAnyGrant(typeDef)
  // granted sessions see less, deliberately:
  if (granted) return declaredInputsOnly(task)
  return fullWorkingContext(task)   // today's behaviour, unchanged
}
```

**State this trade plainly to the user**: granting external reach makes a session *less*
contextually rich. That is intended — the user chose to let it out, so it sees less of
their private material.

---

## 4. Remote changes are structurally un-makeable without confirmation

**Rule**: remote-mutating operations are never exposed to the model as directly callable
tools. The model may call only a **proposal** tool. The application performs the actual
remote call itself, outside the model loop, after the user confirms that specific change.

```ts
// exposed to the model — cannot mutate anything
interface ProposeRemoteChange {
  server: string
  operation: string          // e.g. 'set-status', 'post-comment'
  target: string             // e.g. the issue key
  payload: unknown
}

// NOT exposed to the model — reachable only from the application,
// after a per-change user confirmation
interface RemoteMutator {
  apply(change: ProposeRemoteChange): Promise<RemoteOutcome>
}
```

**Why structural rather than prompt-based.** FR-023 requires a per-change confirmation
immediately before execution. "Always ask the user first" stated in a system prompt is a
request, not a constraint — the model may not honour it. Making the mutating operation
*unreachable from the model's tool surface* makes the requirement structural: an agent
cannot perform what it cannot call. It also gives SC-005 something inspectable — there
simply is no path from a model tool call to a remote write.

Runtime denial via the `tool_call` event is retained as a **second** layer, not the
primary control, because it reasons from declared intent rather than from reachability.

**Reporting**: every attempt reports its outcome, and a failure is never presented as
success (FR-024).

---

## 5. Adopting the community MCP adapter

The agent SDK has **no MCP support** — a deliberate product decision. Its README states
this outright and directs users to build an extension. There is no MCP module, example, or
dependency in the SDK, so there was nothing to enable.

**Decision**: adopt the community package `pi-mcp-adapter`, **pinned to an exact version**,
driven through its SDK entry point `createMcpAdapter({ config })` with an **isolated
in-memory config** built from the app's own registered tool servers.

**Landed 2026-09-22 (`add-mcp-support`) as `pi-mcp-adapter@2.35.0`** — the version whose
published-npm MCP pins clear the reproducibility gate T061 that deferred v2.33.0
(`research.md` R7b). The concrete shape, replacing the illustrative snippet above:

```ts
// src/main/adapters/agent/mcpAdapter.ts — the ONLY file allowed to name the package
// (a guard test enforces it), reached from the session seam with an ALREADY-RESOLVED grant.
export async function buildMcpExtension(entries, grant) {
  if (grant.toolServers.length === 0) return NO_MCP   // confined runs never get here with servers
  const snapshot = snapshotFromGrant(entries, grant.toolServers) // in-memory, isolated
  const factory = await loadAdapter()   // jiti: the package entry is TypeScript-only
  return { extension: factory({ config: { mcpServers: snapshot } }), toolNames: ['mcp'] }
}
```

Registration is at the seam, NOT by turning on the SDK's ambient extension discovery: the
factory is passed as an **inline** `extensionFactories` entry to `DefaultResourceLoader`,
which still runs with `noExtensions: true` (inline factories always load; discovered ones
are what that flag suppresses). The `mcp` proxy tool is then named into the session's
`tools` allowlist. Teardown emits `session_shutdown` before disposing — the adapter stops
its (lazily spawned) servers on exactly that event, which `abort()` alone does not fire.

The settings rows are the source of truth; the standard `mcp.json` the app writes to
`<userData>/pi-agent/mcp.json` is an OUTPUT for inspection and external-tool interop — the
runtime reads the rows, never that file, and never any global/project MCP config path.

**Non-negotiable isolation property**: the app MUST use the in-memory config form. The
adapter's documented behaviour is that supplied in-memory configurations do not read or
write the project or global override files, and that its interactive commands are
unavailable in that mode. This preserves the standing rule that all agent-runtime state
lives under the app's user data directory and never touches the user's `~/.pi` — the same
rule that already governs the Pi runtime, auth, and model files
(`src/main/ai/agent-runtime.ts`).

**Risks recorded, with verification gates** (see `research.md` R7/R7b for the full
analysis; status is the 2026-09-22 landing):

| Risk | Gate | Status at landing |
|---|---|---|
| Adapter deps `@modelcontextprotocol/client` and `core` are pinned to **preview-registry commit URLs**, not published npm versions | A clean `npm install` must succeed reproducibly on both target platforms, with resolved artifacts recorded in the lockfile | **PASSED on 2.35.0** (both are published `2.0.0`); re-asserted on every run by `test/mcpAdapter.test.ts`. Windows half of the install remains unexercised |
| **Native modules** — `@napi-rs/keyring` remains; `fs-native-extensions` is **gone** in 2.35.0 | Must load on Windows and Linux; the Linux secret-service requirement must be documented alongside the existing packaging prerequisites | Linux only, via asar-unpack of the platform binary; loads lazily (not touched at import). Windows **unexercised** — recorded, not assumed |
| A **terminal-UI peer dependency** (`@earendil-works/pi-tui`) | Must be satisfiable without shipping a terminal renderer into a GUI app | Satisfied by pinning the peer at the root; no module imports it |
| The adapter supports OAuth via the OS credential store | No credential material may reach the repository, settings, or logs | **Held**: the app never invokes OAuth/keyring; those act only inside user-pasted config, and isolated-config mode disables the adapter's own auth UI |

**If these gates fail**, the tool-server half is deferred and the grant seam ships alone.
Everything else in this contract is independently valuable and testable without any MCP
transport — the confinement guarantee included, which can be proven against a scripted tool
double. That path requires amending the spec's FR-018 rather than quietly leaving it
claiming unbuilt behaviour (`research.md` R7a).

---

## 6. UI obligations

- The settings surface MUST distinguish a **skill** (a capability) from a **tool server**
  (external reach). They are not interchangeable, and conflating them misrepresents what a
  grant does.
- Granting MUST state the consequence in plain language: the assistant will be able to read
  from and act on that external system, and granted sessions will no longer see the user's
  notes and minutes.
- Removing a grant MUST take effect without requiring the user to recreate the type.
