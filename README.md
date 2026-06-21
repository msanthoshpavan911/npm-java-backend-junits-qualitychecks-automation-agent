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

## Using GitHub Copilot to Fix Violations

After running `springbootquality-check911 init`, your VS Code is configured with an MCP server that gives GitHub Copilot direct access to your project's quality tools. You can ask Copilot to fix violations, review your project, or check coverage — all from the Copilot Chat panel.

### How to Open Copilot Chat

In VS Code: press `Ctrl+Alt+I` (Windows/Linux) or open the Copilot Chat panel from the sidebar.

---

### Fix Staged File Violations

**When to use**: Your `git commit` was blocked because of Checkstyle, PMD, or SpotBugs violations.

**Step 1** — Stage the files you want to commit:
```bash
git add src/main/java/com/example/OrderService.java
```

**Step 2** — Type this in Copilot Chat:
```
Fix the quality violations in my staged files
```

**What happens behind the scenes**:

1. Copilot recognises the intent and calls the `fix` MCP tool automatically
2. The tool runs Checkstyle, PMD, and SpotBugs silently on your staged files
3. It filters the results to **only the lines you changed** — pre-existing violations in untouched code are ignored
4. It collects the violated code chunks and sends them to Copilot along with the violation messages

**What Copilot shows you**:

Copilot reads the violations and generates corrected code. For example:

```
[Checkstyle] OrderService.java:42 — Line contains a tab character
[PMD:UnusedLocalVariable] OrderService.java:55 — Variable 'unusedResult' is unused

Here is the corrected code for lines 42–55:

    public void processOrder(Order order) {
        orderRepository.save(order);   // tab replaced with spaces, unused variable removed
    }
```

**Step 3** — Apply the fix:

- Click **"Apply in Editor"** on the code block Copilot suggests, or
- If you are using **Copilot Edits** (`Ctrl+Shift+I`), Copilot writes directly to the file and you review the diff before accepting

**Step 4** — Commit again:
```bash
git commit -m "your message"
```

---

### All Copilot Chat Phrases You Can Use

| What you type in Copilot Chat | What it does |
|---|---|
| `Fix the quality violations in my staged files` | Runs Checkstyle, PMD, SpotBugs on staged files — returns violations in changed lines only + suggested fixes |
| `Review my project` | Runs a full review: impact analysis + quality checks + coverage check, all in one pass |
| `Check coverage for my changed files` | Runs JaCoCo tests for your staged files and reports per-file line coverage |
| `What files are impacted by my changes?` | Analyses your git changes and identifies which files are affected |
| `Scan my repository` | Rebuilds the repository index so Copilot knows about all your controllers, services, and repositories |
| `Generate tests for <ClassName>` | Generates JUnit5 + Mockito tests for the given class following the project's test standards |

> Copilot does not require exact wording — these are examples. As long as your intent is clear, Copilot will pick the right tool.

---

### What Copilot Knows About Your Project

Because `init` wrote `.github/copilot-instructions.md`, Copilot in this repository always behaves as a **Senior Spring Boot Architect** that:

- Generates JUnit5 tests using Mockito for all public methods
- Fixes Checkstyle, PMD, and SpotBugs violations
- Targets 95% minimum JaCoCo line coverage
- Uses `@WebMvcTest` + `MockMvc` for controller tests and `@ExtendWith(MockitoExtension.class)` for service tests
- Navigates your codebase using the `index` and `read_file` MCP tools — never guesses file paths

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

## Configuring Quality Checks

### First-time setup

Run `init` once inside your Spring Boot project root. It asks which checks you want:

```
springbootquality-check911 init

Available quality checks:
  1. Checkstyle    — Code style (tab characters, line length, naming)
  2. PMD           — Code smells (unused variables, long methods, empty catch)
  3. SpotBugs      — Bug patterns (null dereferences, unclosed streams)
  4. Coverage      — JaCoCo line coverage — minimum 95% on changed files

Select checks to enable (e.g. 1,2,3):
```

Type the numbers separated by commas and press **Enter**. For example:
- `1,2,3` — Checkstyle + PMD + SpotBugs (no coverage)
- `1,4` — Checkstyle + Coverage only
- `1,2,3,4` — all four checks
- _(press Enter with no input)_ — no checks, nothing runs

This creates `.quality-agent.json` in your project root.

---

### Changing your configuration later

**Option 1 — Re-run init** (interactive, recommended):

```bash
springbootquality-check911 init
```

This prompts you again with the same selection screen and rewrites `.quality-agent.json`.

**Option 2 — Edit `.quality-agent.json` directly**:

```json
{
  "checks": {
    "checkstyle": true,
    "pmd": true,
    "spotbugs": false,
    "coverage": true
  }
}
```

Set any check to `false` to disable it. Changes take effect on the next `git commit` — no restart needed.

---

### When to enable or disable each check

| Check | Enable when | Disable when |
|---|---|---|
| **Checkstyle** | You want to enforce consistent code style across the team | Your project already enforces style via a separate tool (e.g. Formatter) |
| **PMD** | You want to catch unused variables, long methods, empty catches before they merge | The project has a large amount of existing PMD violations you are not ready to address |
| **SpotBugs** | You want bytecode-level bug detection on every commit | Maven compile is slow and you prefer SpotBugs only in CI |
| **Coverage** | You want to enforce 95% test coverage on every changed file | You are in early development and coverage is being built up progressively |

---

### Configuration file reference — `.quality-agent.json`

Created by `init`. This is the single source of truth for what runs on every commit.

```json
{
  "checks": {
    "checkstyle": true,
    "pmd": true,
    "spotbugs": true,
    "coverage": true
  }
}
```

- `true` → check runs on every `git commit`
- `false` → check is skipped silently
- If this file is **missing**, no checks run — run `springbootquality-check911 init` to create it

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
