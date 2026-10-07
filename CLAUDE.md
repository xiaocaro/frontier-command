# Frontier Command — Claude Code Project Instructions

@AGENTS.md

## 1. Project Context

This repository is an existing MMO game with stable Lv1/Lv2 functionality.

Current goal:

> Add Lv3 Agent functionality without breaking existing Lv1/Lv2 behavior.

The Lv3 implementation must extend the existing architecture rather than replace the game engine with a parallel architecture.

---

## 2. Mandatory Architecture Rules

### 2.1 Engine authority

`SimulationEngine` is authoritative for game state.

The following must remain true:

```text
Renderer / Agent / LLM
        ↓
Command / Proposal
        ↓
Validation
        ↓
SimulationEngine
        ↓
WorldState
```

LLM and Agents must never directly mutate `WorldState`.

---

### 2.2 Agent boundary

Agent state and ship state are different concepts.

An Agent may own:

- personality
- skills
- goals
- memory
- relationships
- morale
- career state
- decision history

But an Agent must not directly own or mutate the physical world state.

Ship movement, combat, navigation, mining, resources and other authoritative game effects remain controlled by the engine.

---

### 2.3 LLM boundary

LLM output must always be treated as an untrusted proposal.

Required flow:

```text
Observation
    ↓
Prompt / Context
    ↓
LLM
    ↓
Structured Decision
    ↓
Schema Validation
    ↓
Game Rule Validation
    ↓
Command
    ↓
SimulationEngine
```

Never allow an LLM response to directly mutate game state.

---

### 2.4 Tick-loop rule

Do not place network LLM calls inside the synchronous `SimulationEngine.step()` fixed-tick loop.

LLM decisions must occur at explicit Agent decision points / scheduler boundaries.

The simulation must remain deterministic and responsive even when the LLM is slow, unavailable or returns invalid output.

---

## 3. Compatibility Rules

Do not rewrite Lv1/Lv2 unless there is a demonstrated architectural necessity.

Before changing existing modules:

1. identify their current responsibility;
2. identify all callers;
3. identify tests covering them;
4. explain why Lv3 requires the change;
5. minimize the change surface.

Do not perform unrelated refactors.

Avoid modifying these areas unless required:

```text
UI
authentication
unrelated gameplay
database infrastructure
existing Lv1/Lv2 mechanics
```

---

## 4. Existing Contracts

Prefer existing project contracts over introducing parallel abstractions.

Important existing concepts include:

- SimulationEngine
- WorldState
- Observation
- Command
- Action
- AgentControllerPort
- SaveStore
- existing Zod validation

Do not create a second runtime validation architecture that conflicts with the current one.

---

## 5. Lv3 Design Rules

Lv3 should be decomposed into explicit modules rather than one large Agent class.

Preferred conceptual structure:

```text
Agent
 ├── State
 ├── Goals
 ├── Memory
 ├── Planner
 ├── Decision
 ├── Executor
 ├── Validator
 └── Reflection
```

Responsibilities must remain separated.

Avoid large "god classes".

---

## 6. Schema Rules

All important Lv3 domain contracts should have machine-readable schemas.

Examples:

```text
schemas/
├── agent.schema.json
├── agent-state.schema.json
├── agent-goal.schema.json
├── agent-decision.schema.json
├── agent-memory.schema.json
├── agent-message.schema.json
└── agent-interaction.schema.json
```

JSON Schema is the cross-tool contract.

Runtime validation remains implemented by the project's existing TypeScript/Zod layer where appropriate.

Do not invent schema fields without documenting their meaning.

---

## 7. Prompt Rules

Prompts must be versioned and stored outside core business logic where practical.

Prefer:

```text
prompts/
└── agent/
    ├── system.md
    ├── decision.md
    ├── planning.md
    └── reflection.md
```

Do not bury large prompts inside TypeScript source files.

Every structured LLM response must have a defined schema.

---

## 8. Documentation Rules

Important architectural decisions must be written to repository files.

Do not leave critical architecture knowledge only in the conversation.

Use:

```text
docs/lv3/
```

Recommended documents:

```text
00-baseline.md
00-code-map.md
01-lv1-lv2-architecture.md
01-runtime-call-graph.md
01-state-and-command-map.md
01-agent-gap-analysis.md
02-architecture.md
02-domain-model.md
02-decision-flow.md
02-persistence-strategy.md
03-implementation-plan.md
03-file-change-plan.md
03-api-contract.md
03-test-plan.md
CODEX_TASKS.md
CLAUDE_TO_CODEX.md
KNOWN_ISSUES.md
```

Documentation should describe the actual code, not an imagined architecture.

---

## 9. Change Scope Rules

Before implementation, produce a file-level change plan.

Classify files as:

```text
CREATE
MODIFY
DELETE
DO NOT MODIFY
```

Do not silently expand scope.

When a new file/module becomes necessary, explain why.

---

## 10. Testing Rules

After every meaningful implementation stage:

```bash
git diff --check
npm test
```

When appropriate:

```bash
npm run build
npm run test:e2e
```

Never claim that a test passes unless it was actually executed successfully.

If a test cannot run, record:

- command attempted
- reason for failure
- whether the failure is environmental or code-related

Maintain regression coverage for Lv1/Lv2.

---

## 11. Git Rules

Use small semantic commits.

Preferred pattern:

```text
chore(agent): document lv1-lv2 architecture
feat(agent): define lv3 contracts
feat(agent): add agent domain foundation
feat(agent): add llm decision runtime
feat(agent): integrate agent scheduler
feat(agent): complete lv3 vertical slice
chore(agent): prepare codex handoff
```

Do not create one giant "Lv3 implementation" commit.

Before creating a commit:

```bash
git status
git diff --check
npm test
```

---

## 12. Claude Code Workflow

For major Lv3 phases:

1. inspect before editing;
2. document the current state;
3. produce or update the plan;
4. implement the smallest coherent increment;
5. run tests;
6. update documentation;
7. commit.

Do not skip directly from vague requirements to large-scale implementation.

---

## 13. `/clear` Rule

Use `/clear` after major architectural phases when the previous conversation contains exploratory reasoning that is no longer required.

Before `/clear`, ensure that important conclusions have been written to:

```text
docs/lv3/
```

The repository must be the source of truth, not the previous chat session.

---

## 14. Handoff to Codex

Claude Code must leave enough information for another coding agent to continue from a fresh context.

Before handoff, create/update:

```text
docs/lv3/CODEX_TASKS.md
docs/lv3/CLAUDE_TO_CODEX.md
docs/lv3/KNOWN_ISSUES.md
```

The handoff must state:

- what has been implemented;
- what files changed;
- what contracts were introduced;
- what tests pass;
- what remains;
- known limitations;
- recommended next task;
- things Codex must not rewrite.

---

## 15. Conflict Resolution

If any of the following disagree:

```text
requirements
docs
AGENTS.md
CLAUDE.md
actual source code
tests
```

do not silently choose one.

Stop and explicitly report the conflict.

Prefer:

```text
actual behavior + tests
```

when documenting the current architecture, and require an explicit design decision before changing behavior.

---

## 16. Source of Truth

For current behavior:

```text
Source code + tests
```

For intended Lv3 architecture:

```text
docs/lv3/
```

For machine-readable contracts:

```text
schemas/
```

For Claude-specific workflow:

```text
CLAUDE.md
```

For repository-wide agent instructions:

```text
AGENTS.md
```

---

## 17. Final Principle

Do not optimize for "Claude Code producing the most code".

Optimize for:

```text
Understand
→ Specify
→ Contract
→ Implement
→ Test
→ Document
→ Handoff
```

Another coding agent must be able to continue from the repository without depending on hidden conversation context.