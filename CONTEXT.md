# Beyond the Dialogue — Domain Glossary

An AI-native work board: a desktop to-do application whose AI capabilities attach to
tasks rather than to a chat window. This file is the canonical vocabulary; names under
_Avoid_ must not resurface in specs, plans, or code.

## Product & process

**Master specification**:
The product source of truth, `doc/specification/1- Specification.md`; every feature spec
draws from it.
_Avoid_: PRD, idea doc

**Reference implementation (POC)**:
The current shipping code, kept only as a reference for the redesign; conflicts with the
design are resolved by refactoring the code away, not by changing the taxonomy.
_Avoid_: legacy app (it is a deliberate prototype, not an accident)

**Redesign**:
The ongoing re-design of the whole application under the master specification's taxonomy.

## Work organization

**Task**:
A unit of the user's daily work tracked by the board, optionally with background, target,
attachments, and an alarm.

**List**:
A user-owned grouping of tasks.
_Avoid_: Category (reserved ambiguity: retired from both senses; use List for grouping,
Family for assist classification)

**Alarm**:
A user-set date-time on a task that produces a timed notification.

## AI assistance

**Family**:
One of the three user-facing classifications of AI assistance — `Document`, `Working
system`, `Coding`. The family set comes from the master specification and is canonical.

**Type**:
A selectable workflow configuration within a family, built-in or user-defined
(customized type), deciding what the assist does for a task of that kind.

**Working area**:
The space in which the user does the actual work on a task alongside the assist; its
layout may become user-decided (open, design phase).

**Coding observer**:
The stance of the Coding family: the application analyzes external development activity
(the user's PRs and progress) and records it; it never writes or mutates code itself.

## External systems

**Connector**:
An integration that lets the application read from (and, under confirmation, write to) an
external system such as GitHub, JIRA, or Confluence.

**Proposal**:
A candidate change to an external system, shown to the user with its literal payload;
the only remote-mutation path the agent has.

**Confirmation**:
The user's per-change approval that makes a Proposal executable. Without it the change is
structurally unmakeable, not merely discouraged.

## Knowledge

**Wiki**:
A user-owned markdown knowledge base, following the LLM-wiki pattern, where finished
Document-type work is organized and kept.
