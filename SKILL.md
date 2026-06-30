---
name: Spring Boot Quality Agent
description: >
  A GitHub Copilot agent for Spring Boot projects that enforces code quality
  on every git commit — runs Checkstyle, PMD, SpotBugs, and JaCoCo coverage
  (95% threshold) automatically via git hooks. Includes two MCP servers:
  SpringBoot Architect (8 tools) for code navigation and fixes, and JUnit
  Coverage Expert for auto-generating JUnit 5 tests with iterative coverage
  validation up to 95%.
tags:
  - spring-boot
  - java
  - maven
  - junit5
  - jacoco
  - checkstyle
  - pmd
  - spotbugs
  - mcp
  - git-hooks
  - code-quality
  - copilot
  - testing
  - backend
---

# Spring Boot Quality Agent

## What this skill does

Installs a pre-commit git hook that automatically enforces the following quality
checks on every `git commit` in a Spring Boot/Maven project:

| Check | Tool | What it enforces |
|---|---|---|
| **Checkstyle** | Google Java Style Guide | Code formatting, naming conventions, structure — changed lines only |
| **PMD** | Custom rules | Code smells, cyclomatic complexity, unused code — changed lines only |
| **SpotBugs** | SpotBugs Maven plugin | Null dereferences, resource leaks, bug patterns — changed classes only |
| **JaCoCo Coverage** | JaCoCo | 95% line coverage per changed production file |

All checks are scoped to **changed lines only** — not the whole file — so developers
are never blocked by pre-existing violations they didn't introduce.

---

## When to use this skill

- Starting a new Spring Boot project and want quality gates from day one
- Client engagements where Java code quality and test coverage are contractually required
- Onboarding a team onto consistent Spring Boot coding standards
- Any Maven project where developers are committing untested or low-quality Java code

---

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js | >= 18.0.0 |
| Java | >= 11 |
| Maven | >= 3.6 |
| Git | Any recent version |
| Python | For MCP server (auto-configured via venv) |
| VS Code | With GitHub Copilot extension |
| GitHub Copilot | Existing licence — no extra cost |

---

## How to use

### Step 1 — Install the package globally

```bash
npm install -g springbootquality-check911
```

### Step 2 — Run setup in your Spring Boot project root

```bash
cd your-spring-boot-project
springbootquality-check911 init
```

Select which quality checks to enable:
```
1. Checkstyle  — Google Java Style Guide
2. PMD         — Code smells: unused imports, long methods
3. SpotBugs    — Bug patterns: null dereferences, open streams
4. Coverage    — JaCoCo minimum 95% line coverage
```
> Press Enter to enable all (recommended).

### Step 3 — Install git hooks

```bash
springbootquality-check911 hooks
```

### Step 4 — (Optional) Scan and index your codebase

```bash
springbootquality-check911 scan
```

---

## What happens on every `git commit`

```
git commit
    │
    ▼
Checkstyle + PMD + SpotBugs  →  fail: shows violations per changed line
    │                              asks Copilot to fix via MCP
    │ pass
    ▼
JaCoCo Coverage 95%          →  fail: asks Copilot to generate JUnit 5 tests
    │                              JUnit Coverage Expert iterates up to 5 rounds
    │ pass
    ▼
commit saved ✅
```

---

## MCP Servers

Two MCP servers are configured automatically in `.vscode/mcp.json` after `init`:

### 1. SpringBoot Architect — 8 tools

| Tool | Ask Copilot |
|---|---|
| `fix` | "Fix the quality violations in my staged files" |
| `quality` | "Run quality checks on my staged files" |
| `coverage` | "Check JaCoCo coverage for my changed files" |
| `index` | "Index my repository" |
| `impact` | "What files are impacted by my changes?" |
| `review_project` | "Do a full review of my project" |
| `read_file` | "Read src/main/java/...UserService.java" |
| `write_file` | "Write the fixed version of UserServiceImpl.java" |

### 2. JUnit Coverage Expert — 3 tools

Dedicated agent that **iteratively generates JUnit 5 tests** until 95% coverage is reached (up to 5 rounds):

| Tool | Purpose |
|---|---|
| `read_file` | Reads the Java source class to test |
| `write_file` | Writes the generated test file |
| `run_tests_for` | Runs Maven + JaCoCo, returns coverage % |

**Ask Copilot:**
> "Generate JUnit5 tests for UserServiceImpl with 95% coverage"

The agent automatically:
1. Reads the source class
2. Generates framework-appropriate tests (`@WebMvcTest` for controllers, `@ExtendWith(MockitoExtension)` for services, `@DataJpaTest` for repositories)
3. Writes the test file
4. Runs tests and checks coverage
5. Adds more test cases if below 95% — repeats up to 5 times

---

## Generated files

| File | Purpose |
|---|---|
| `.quality-agent.json` | Project quality configuration |
| `.github/copilot-instructions.md` | Full JUnit 5 test generation workflow (184 lines) |
| `.github/instructions/controllers.md` | Scoped Copilot rules for controllers |
| `.github/instructions/services.md` | Scoped Copilot rules for services |
| `.github/instructions/tests.md` | Scoped Copilot rules for test generation |
| `.vscode/mcp.json` | MCP server config (SpringBoot Architect + JUnit Coverage Expert) |
| `docs/repository-index.md` | Auto-generated file index |
| `docs/architecture.md` | Full architecture doc — endpoints, services, DB model, ASCII diagram |

---

## Architecture doc generated by `scan`

Running `springbootquality-check911 scan` generates `docs/architecture.md` containing:

- API quick-reference table (all endpoints with HTTP method, path, auth)
- End-to-end flow per endpoint: Controller → Service → Repository → DB
- Service operations table with plain-English descriptions
- Repository custom query methods
- Data model with field annotations and inferred meaning
- ASCII layer diagram

---

## npm package

```
Package : springbootquality-check911
Registry: https://www.npmjs.com/package/springbootquality-check911
License : MIT
Author  : mamidi-santhosh
```

---

## Capability category

**Delivery transformation** — enforces Java code quality, test coverage, and
static analysis standards on Spring Boot client projects, reducing technical
debt and audit risk from day one of the engagement.
