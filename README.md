# springbootquality-check911

A developer CLI that enforces code quality and test coverage on your Spring Boot projects — automatically, on every commit.

- Runs **Checkstyle**, **PMD**, and **SpotBugs** on your staged Java files before every commit
- Enforces **95% JaCoCo line coverage** on changed files before every commit
- Lets you **scan manually** before committing to preview issues early
- Configures **GitHub Copilot** with Spring Boot-specific instructions via MCP
- Works as a **git pre-commit hook** — no CI changes required

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18.0.0 |
| Java | >= 11 |
| Maven | >= 3.6 |
| Git | any |

Your Spring Boot project must use Maven (`pom.xml`). The following Maven plugins must be configured in your `pom.xml` for quality checks to work:

- `maven-checkstyle-plugin` — for Checkstyle
- `maven-pmd-plugin` — for PMD
- `spotbugs-maven-plugin` — for SpotBugs
- `jacoco-maven-plugin` — for coverage

> If a plugin is missing, the tool warns you (`⚠️`) instead of failing.

---

## Installation

Install the package globally:

```bash
npm install -g springbootquality-check911
```

---

## End-to-End Setup (First Time)

Run these three commands once inside your Spring Boot project root:

### Step 1 — Initialize

```bash
springbootquality-check911 init
```

This will:
- Ask which quality checks you want to enable:

```
Available quality checks:
  1. Checkstyle    — Code style — Google Java Style Guide
  2. PMD           — Code smells — unused imports, long methods
  3. SpotBugs      — Bug patterns — null dereferences, open streams
  4. Coverage      — JaCoCo — minimum 95% line coverage

Select checks to enable (e.g. 1,2,3):
```

- Type the numbers of the checks you want, separated by commas (e.g. `1,4` for Checkstyle + Coverage)
- Press **Enter with no input** → no checks configured (nothing runs)

After selection it creates:

| File | Purpose |
|---|---|
| `.quality-agent.json` | Stores your selected checks |
| `.github/copilot-instructions.md` | Copilot instructions scoped to your choices |
| `.github/instructions/controller.instructions.md` | Controller layer guidelines |
| `.github/instructions/service.instructions.md` | Service layer guidelines |
| `.github/instructions/test.instructions.md` | Test writing standards |
| `.vscode/mcp.json` | MCP server config for Copilot |
| `docs/repository-index.md` | Repository index (populated by `scan`) |
| `docs/architecture.md` | Architecture doc stub |

### Step 2 — Index your Java files (optional, for Copilot)

```bash
springbootquality-check911 scan
```

Scans all Java files and builds a structured index of your controllers, services, repositories, and their methods. This powers the MCP server so GitHub Copilot can navigate your codebase accurately.

### Step 3 — Install git hooks

```bash
springbootquality-check911 hooks
```

Installs a pre-commit hook that automatically runs quality checks and coverage verification before every `git commit`. Creates `.githooks/pre-commit` and configures git to use it.

---

## How It Works on Every Commit

When you run `git commit`, the pre-commit hook fires automatically:

```
git commit -m "your message"

Running Spring Boot quality checks...
Checking changed chunks in: OrderService.java

Running Checkstyle... ✅
Running PMD...        ✅
Running SpotBugs...   ✅

--- Quality Summary ---
✅ Checkstyle passed
✅ PMD passed
✅ SpotBugs passed

All quality checks passed.

Verifying test coverage...
Changed files : OrderService
Running tests : OrderService*

--- Coverage (changed files only) ---
  ✅ OrderService: 97.2%

✅ Coverage verified for all changed files.

[main abc1234] your message
```

If violations are found, the commit is **blocked**:

```
Running Checkstyle... ❌
  [Checkstyle] OrderService.java:42 — 'if' is not followed by whitespace.
  [Checkstyle] OrderService.java:67 — Line is longer than 100 characters.

--- Quality Summary ---
❌ Checkstyle: 2 violation(s) in your changed lines

Fix the violations and try committing again.
```

> Only violations **in your changed lines** are reported — not the entire file. This means existing violations in untouched code do not block your commit.

---

## Manual Usage — Scan Before Committing

You can run quality checks and coverage **at any time** before committing to catch issues early.

### Stage your files first

```bash
git add src/main/java/com/example/OrderService.java
```

### Scan for quality violations

```bash
springbootquality-check911 quality
```

Runs Checkstyle, PMD, and SpotBugs on your staged Java files and reports any violations in the lines you changed.

### Check test coverage

```bash
springbootquality-check911 coverage
```

Runs JUnit tests for your staged/changed files and reports JaCoCo line coverage. Only checks coverage for the files you changed — not the whole application.

---

## Quality Checks Explained

### Checkstyle
Enforces **Google Java Style Guide**:
- Indentation (2 spaces)
- Line length (max 100 chars)
- Whitespace around operators and keywords
- Import ordering and unused imports
- Javadoc presence on public methods

### PMD
Detects **code smells**:
- Unused imports and variables
- Methods longer than 30 lines
- Empty catch blocks
- Non-meaningful variable names
- God classes

### SpotBugs
Finds **bug patterns** in compiled bytecode:
- Null dereferences
- Unclosed streams and connections
- Missing `equals`/`hashCode` implementations
- Thread safety violations

### Coverage (JaCoCo)
Enforces **95% minimum line coverage** on changed production files:
- Runs only the tests related to your changed files (not the full test suite)
- Reports per-file coverage percentages
- Blocks the commit if any changed file is below 95%

---

## Configuration File — `.quality-agent.json`

Created by `springbootquality-check911 init`. Controls which checks run.

```json
{
  "checks": {
    "checkstyle": true,
    "pmd": false,
    "spotbugs": true,
    "coverage": true
  }
}
```

- Set a check to `true` to enable it, `false` to disable it
- Re-run `springbootquality-check911 init` anytime to reconfigure
- If this file is missing, **no checks run** — you must run `init` first

---

## Command Reference

```
springbootquality-check911 <command>
```

| Command | When to Use | What It Does |
|---|---|---|
| `init` | Once per project | Prompts for check selection, creates config and Copilot instructions |
| `scan` | After adding new files | Indexes all Java files for MCP/Copilot navigation |
| `quality` | Before committing | Scans staged files for Checkstyle, PMD, SpotBugs violations |
| `coverage` | Before committing | Checks JaCoCo coverage for staged/changed files only |
| `hooks` | Once per project | Installs pre-commit hook that auto-runs `quality` + `coverage` |

Run `springbootquality-check911 --help` to see this at any time.

---

## Upgrading

```bash
npm install -g springbootquality-check911@latest
```

After upgrading, re-run hooks in your project to get the latest hook script:

```bash
springbootquality-check911 hooks
```

---

## Troubleshooting

### "No .quality-agent.json found"
Run `springbootquality-check911 init` in your Spring Boot project root to create the config file.

### "⚠️ Checkstyle: report not generated"
Add `maven-checkstyle-plugin` to your `pom.xml`. The tool cannot run Checkstyle without it.

### "No staged Java files — skipping"
Stage your Java files before running quality or coverage:
```bash
git add src/main/java/...
```

### Coverage blocks commit even for small changes
Coverage only runs on the files you changed. If a changed file has no associated test (e.g. `OrderService.java` → `OrderServiceTest.java`), JaCoCo has no data for it. Add tests for the changed class.

### Pre-commit hook not running
Make sure you ran `springbootquality-check911 hooks`. Verify git is configured to use the hooks:
```bash
git config core.hooksPath
# should output: .githooks
```

---

## License

MIT © [mamidi-santhosh](https://github.com/mamidi-santhosh)
