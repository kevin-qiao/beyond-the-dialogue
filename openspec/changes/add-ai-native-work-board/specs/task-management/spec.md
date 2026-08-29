# Delta Spec: task-management

## Purpose

Provides the to-do core of the app: task lists, task creation and completion, and the manual "My Day" daily planning view with Microsoft To-Do-style rollover semantics. All other capabilities (AI suggestions, paper-reading enrichment) attach to tasks created here.

## ADDED Requirements

### Requirement: Task lists
The system SHALL support multiple named task lists, each containing tasks. Users SHALL be able to create, rename, and delete lists. Deleting a list SHALL delete or archive its tasks.

#### Scenario: Create a list
- **WHEN** the user creates a new list with a name
- **THEN** the list appears in the navigation and accepts tasks

#### Scenario: Delete a list
- **WHEN** the user deletes a list that contains tasks
- **THEN** the list and its tasks are removed from the active views

### Requirement: Task CRUD and completion
The system SHALL allow users to create tasks with a title and optional notes within a list, edit them, delete them, and mark them complete or incomplete. Completed tasks SHALL remain visible (struck through) in their list and in My Day for the rest of the day.

#### Scenario: Create and complete a task
- **WHEN** the user adds a task to a list and later clicks its completion control
- **THEN** the task is shown as completed (struck through) but remains in the list

#### Scenario: Edit a task
- **WHEN** the user edits a task's title or notes
- **THEN** the changes are persisted and reflected everywhere the task is shown

### Requirement: Task types
The system SHALL support at least two task types: plain tasks and paper-reading tasks. The type SHALL be selected at task creation and determines which detail panel and enrichment behavior the task gets. Plain tasks SHALL work exactly as described above; paper-reading tasks additionally follow the paper-reading capability.

#### Scenario: Create a plain task
- **WHEN** the user creates a task without selecting the paper-reading type
- **THEN** the task has no enrichment fields and shows a simple detail view

### Requirement: My Day view
The system SHALL provide a "My Day" view that shows only tasks the user has explicitly added to it. Adding a task to My Day SHALL be a manual action performed by the user; the system MUST NOT auto-populate My Day in v1. A task SHALL belong to its original list while also appearing in My Day.

#### Scenario: Add task to My Day
- **WHEN** the user adds a task to My Day
- **THEN** the task appears in the My Day view and also remains in its original list

#### Scenario: Remove task from My Day
- **WHEN** the user removes a task from My Day
- **THEN** the task disappears from My Day but remains in its original list

### Requirement: My Day daily rollover
The system SHALL clear completed tasks from My Day on the first app open after a day change. Incomplete tasks SHALL persist in My Day across days until completed or manually removed.

#### Scenario: Completed tasks clear on new day
- **WHEN** the user opens the app on a new day after having completed tasks in My Day the previous day
- **THEN** completed tasks no longer appear in My Day

#### Scenario: Incomplete tasks persist
- **WHEN** the user opens the app on a new day with incomplete tasks still in My Day
- **THEN** those tasks still appear in My Day

### Requirement: Local-first persistence
All tasks and lists SHALL be persisted locally on the user's machine and SHALL survive app restarts without requiring any account or network service.

#### Scenario: Restart preserves state
- **WHEN** the user quits and reopens the app
- **THEN** all lists, tasks, My Day membership, and completion states are exactly as before
