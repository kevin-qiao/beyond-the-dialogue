# Delta Spec: ai-runtime

## Purpose

Embeds an AI agent runtime in the app's backend process so all AI features (task suggestions, paper analysis, wiki ingestion) run locally-managed background jobs: isolated agent sessions, user-configured provider/model/key, curated tool access, and observable job states.

## ADDED Requirements

### Requirement: Provider settings
The system SHALL provide a settings interface where the user configures the LLM provider, model, and API key used by all AI features. The configured credentials SHALL be stored locally in the app's private data directory and MUST NOT be shared with or overwrite any user-level agent tool configuration (e.g., a personal `~/.pi` directory).

#### Scenario: Configure provider
- **WHEN** the user selects a provider, enters a model identifier and API key, and saves settings
- **THEN** subsequent AI jobs use that provider and model

#### Scenario: Credentials stay isolated
- **WHEN** the user configures the app's API key
- **THEN** no files outside the app's own data directory are created or modified for credential storage

### Requirement: No-key graceful degradation
When no provider or API key is configured, the app SHALL remain fully functional for non-AI features (lists, tasks, My Day, notes). AI-dependent features SHALL present a clear, non-blocking indication that configuration is required and MUST NOT crash or corrupt task state.

#### Scenario: AI features without key
- **WHEN** the user moves a task to My Day with no API key configured
- **THEN** the task is added to My Day successfully and the task shows a non-blocking "AI not configured" indicator instead of analysis results

### Requirement: Job queue and states
The system SHALL run each AI job (suggestion, analysis, ingestion) as a background job with observable states. A job SHALL transition through at least: queued → running → done | failed. The UI SHALL surface per-task progress (including human-readable step labels where available) without blocking the user's interaction with any part of the app.

#### Scenario: Job progress visible
- **WHEN** a paper analysis job is running
- **THEN** the affected task shows an in-progress indication with the current step, and the user can navigate and edit other tasks meanwhile

#### Scenario: Job failure is contained
- **WHEN** an AI job fails (e.g., provider error, unreachable link)
- **THEN** the job is marked failed with a human-readable reason and a retry affordance, and no other task or job is affected

### Requirement: Session isolation
Each AI job SHALL run in an isolated agent session with no shared conversational memory with other jobs. Jobs SHALL receive all needed context explicitly at dispatch. Job sessions SHALL NOT be persisted as user-visible agent session history.

#### Scenario: Jobs do not leak context
- **WHEN** two AI jobs run for different tasks concurrently
- **THEN** neither job's prompts, tool results, nor outputs are visible to the other

### Requirement: Scoped tool access
The agent runtime SHALL grant each job only the tools that job needs. Jobs that operate on the user's learning space MUST NOT have shell/command-execution access, and their file access SHALL be confined to the app vault and the configured learning-space directory. Jobs MUST NOT be able to read or write arbitrary locations on the user's machine.

#### Scenario: Ingestion agent is confined
- **WHEN** a wiki-ingestion job runs
- **THEN** it has read/write access only within the learning-space directory and app vault, and no shell tool

#### Scenario: Analysis agent is confined
- **WHEN** a paper-analysis job runs
- **THEN** it has network fetch and PDF-extraction tools plus read access to its own job workspace, and no shell tool

### Requirement: Concurrency limit
The system SHALL limit concurrent agent jobs (at most two running at once) and queue the rest, preserving per-task ordering (a task's ingestion does not start before its analysis completes).

#### Scenario: Queue overflow
- **WHEN** the user moves three paper tasks to My Day in quick succession
- **THEN** at most two analyses run at once and the third starts when a slot frees

### Requirement: Automatic retry
Transient provider failures (rate limits, overloaded, temporary network errors) SHALL be retried automatically with backoff up to a configured limit before the job is marked failed.

#### Scenario: Rate limit retried
- **WHEN** the provider returns a rate-limit error during analysis
- **THEN** the job retries automatically after a delay and completes if a retry succeeds

### Requirement: AI task suggestions
When a task is added to My Day, the system SHALL generate 2–3 short, dismissible suggestions about that task, based only on that task's title and notes, its list name, the titles of other tasks in My Day, and local time. Suggestions MUST NOT modify the task automatically; acting on a suggestion (e.g., splitting a task) SHALL require explicit user action.

#### Scenario: Suggestions appear and are dismissible
- **WHEN** the user adds a task to My Day and the suggestion job completes
- **THEN** the task shows 2–3 suggestion chips, each dismissible individually

#### Scenario: Suggestions never mutate tasks
- **WHEN** suggestions are generated
- **THEN** the task's title, notes, and state are unchanged unless the user explicitly accepts a suggestion that changes them

### Requirement: Local-first persistence of job results
Job outputs that users rely on (analysis results, suggestions, ingestion outcomes) SHALL be persisted locally so they survive app restarts; the queue SHALL resume interrupted jobs (re-run from their start) on app launch.

#### Scenario: Restart resumes interrupted jobs
- **WHEN** the app is closed while an analysis job is running and reopened later
- **THEN** the job is re-run or its completed results are shown, and no task is left in a permanently stuck "running" state
