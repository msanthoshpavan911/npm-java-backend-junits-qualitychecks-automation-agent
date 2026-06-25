# springbootquality-check911

A developer CLI that enforces code quality and test coverage on your Spring Boot projects — automatically, on every commit.

- Runs **Checkstyle**, **PMD**, and **SpotBugs** on your staged Java files before every commit
- Enforces **95% JaCoCo line coverage** on changed files before every commit
- Configures **GitHub Copilot** with a full JUnit test generation workflow — just ask in Agent mode
- Configures an **MCP server** so Copilot can navigate and fix your project directly
- Works as a **git pre-commit hook** — no CI changes required

---

## What it does

Every `git commit` automatically runs all enabled checks in sequence:

```
git commit -m "your message"
        │
        ▼
  ┌─────────────┐   fail → shows Checkstyle/PMD/SpotBugs violations → fix & re-stage
  │   quality   │
  └──────┬──────┘
         │ pass
         ▼
  ┌─────────────┐   fail → shows coverage % per file → use Copilot Agent mode
  │  coverage   │
  └──────┬──────┘
         │ all pass
         ▼
     commit saved ✅
```

---

## Requirements

- Node.js >= 18.0.0
- Java >= 11
- Maven >= 3.6
- Git
- VS Code + GitHub Copilot (for AI-assisted test generation)

Your `pom.xml` must include these plugins for checks to run:

- `maven-checkstyle-plugin` — Checkstyle
- `maven-pmd-plugin` — PMD
- `spotbugs-maven-plugin` — SpotBugs
- `jacoco-maven-plugin` — Coverage

> If a plugin is missing, the tool warns you (`⚠️`) instead of failing.

---

## Installation

```bash
npm install -g springbootquality-check911
```

---

## Setup (First Time)

### Step 1 — Initialize your project

```bash
springbootquality-check911 init
```

Select which quality checks to enable:

```
1. Checkstyle  — Code style — Google Java Style Guide
2. PMD         — Code smells — unused imports, long methods
3. SpotBugs    — Bug patterns — null dereferences, open streams
4. Coverage    — JaCoCo — minimum 95% line coverage
```

> Press **Enter** with no input to skip all, or enter numbers like `1,2,3,4` to enable all.

**Files created by `init`:**

| File | Purpose |
|---|---|
| `.quality-agent.json` | Your project's quality configuration |
| `.github/copilot-instructions.md` | Full JUnit test generation workflow + Spring Boot guidelines for Copilot |
| `.github/instructions/` | Scoped guidelines for controllers, services, and tests |
| `.vscode/mcp.json` | Connects MCP server to VS Code Copilot Chat |
| `docs/repository-index.md` | Repository index — populated by `scan` |
| `docs/architecture.md` | Architecture doc stub |

### Step 2 — Install git hooks

```bash
springbootquality-check911 hooks
```

### Step 3 — (Optional) Scan your codebase

```bash
springbootquality-check911 scan
```

Indexes all controllers, services, and repositories so Copilot can navigate your project accurately.

---

## Generating JUnit Tests with 95% Coverage

After running `init`, `.github/copilot-instructions.md` contains a full step-by-step JUnit test generation workflow. VS Code Copilot reads this file automatically in Agent mode.

### How to use

**Step 1** — Open Copilot Chat in VS Code (`Ctrl+Alt+I`)

**Step 2** — Click the mode dropdown at the bottom-left of the chat input and select **Agent**

**Step 3** — Type:
```
Generate JUnit5 tests for UserServiceImpl with 95% coverage
```

No file attachment needed. Copilot finds the file itself.

### What Copilot does automatically

1. **Finds** the Java file using terminal (`dir /s /b "ClassName.java"`)
2. **Reads** the class — package, type (`@Service` / `@RestController` / `@Repository`), injected fields, public methods
3. **Generates** a complete JUnit 5 test class with the correct pattern:
   - Services → `@ExtendWith(MockitoExtension.class)` + `@Mock` + `@InjectMocks` + `lenient()` stubs in `@BeforeEach`
   - Controllers → `@WebMvcTest` + `MockMvc`
   - Repositories → `@DataJpaTest`
4. **Writes** the test file to `src/test/java/.../<ClassName>Test.java`
5. **Runs** `mvn test jacoco:report -Dtest=<ClassName>Test`
6. **Reads** `target/site/jacoco/jacoco.xml` and computes line coverage
7. **Iterates** up to 5 times — adds tests for uncovered branches, rewrites the file, re-runs Maven
8. **Stops** when coverage ≥ 95% and reports the result

### What the generated tests look like

```java
@ExtendWith(MockitoExtension.class)
class UserServiceImplTest {

    @Mock private UserRepository userRepository;

    @InjectMocks private UserServiceImpl userService;

    @BeforeEach
    void setUp() {
        lenient().when(userRepository.findById(any()))
                 .thenReturn(Optional.of(mock(User.class)));
        lenient().when(userRepository.save(any()))
                 .thenReturn(mock(User.class));
        lenient().when(userRepository.findAll())
                 .thenReturn(Collections.singletonList(mock(User.class)));
    }

    @Test
    void getUser_happyPath() {
        var result = userService.getUser(1L);
        assertNotNull(result);
    }

    @Test
    void getUser_whenNotFound_throwsException() {
        when(userRepository.findById(any())).thenReturn(Optional.empty());
        assertThrows(Exception.class, () -> userService.getUser(999L));
    }
}
```

### Final report

```
✅ UserServiceImpl — 97.3% line coverage (3 iterations)
Test file: src/test/java/com/example/service/UserServiceImplTest.java
Test methods created: 8
```

---

## Using GitHub Copilot to Fix Violations

After `init`, VS Code Copilot Chat gets access to MCP tools via `.vscode/mcp.json`. Open Copilot Chat (`Ctrl+Alt+I`), switch to **Agent** mode, and use these prompts:

| What you type | What it does |
|---|---|
| `Generate JUnit5 tests for ClassName with 95% coverage` | Finds file, generates tests, runs Maven, iterates until 95% |
| `Fix the quality violations in my staged files` | Runs Checkstyle, PMD, SpotBugs on staged files — returns violations + fixes |
| `Check coverage for my changed files` | Runs JaCoCo tests for changed files and reports per-file line coverage |
| `Scan my repository` | Rebuilds the repository index for all controllers, services, and repositories |

### What Copilot knows about your project

Because `init` wrote `.github/copilot-instructions.md`, Copilot always behaves as a **Senior Spring Boot Architect** that:

- Generates JUnit 5 tests using the correct pattern for each class type
- Targets 95% minimum JaCoCo line coverage
- Uses `lenient()` stubs in `@BeforeEach` to prevent `UnnecessaryStubbingException`
- Fixes Checkstyle, PMD, and SpotBugs violations
- Navigates your codebase using MCP tools — never guesses file paths

---

## Quick Reference

```bash
# First time setup
npm install -g springbootquality-check911
springbootquality-check911 init
springbootquality-check911 hooks
springbootquality-check911 scan

# Run checks manually
springbootquality-check911 quality
springbootquality-check911 coverage

# Skip hooks for a specific commit (use sparingly)
git commit --no-verify -m "your message"
```

---

## Commands

### `init`
First-time project setup. Selects quality checks and creates all config files including the Copilot instructions with the full JUnit test generation workflow.

### `quality`
Runs Checkstyle, PMD, and SpotBugs on **only the lines you changed** in staged Java files.

**If it fails:** Ask Copilot (Agent mode) — `Fix the quality violations in my staged files`

### `coverage`
Runs JUnit tests for staged/changed Java files and verifies JaCoCo line coverage meets the 95% threshold.

**If it fails:** Ask Copilot (Agent mode) — `Generate JUnit5 tests for ClassName with 95% coverage`

### `scan`
Analyzes the codebase and generates `docs/repository-index.md` and `docs/architecture.md` for Copilot context.

### `hooks`
Installs the pre-commit git hook. Runs: `quality` → `coverage`.

---

## Configuration

All checks read from `.quality-agent.json`:

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

Set any check to `false` to disable it.

### Thresholds

| Check | Threshold |
|---|---|
| Checkstyle | Any violation in changed lines blocks |
| PMD | Any violation in changed lines blocks |
| SpotBugs | Any violation in changed lines blocks |
| JaCoCo coverage | 95% per changed file |

---

## Troubleshooting

### Pre-commit hook not running
```bash
springbootquality-check911 hooks
git config core.hooksPath   # should output: .githooks
```

### "No .quality-agent.json found"
```bash
springbootquality-check911 init
```

### "⚠️ Checkstyle: report not generated"
Add `maven-checkstyle-plugin` to your `pom.xml`.

### Coverage below 95%
Ask Copilot in Agent mode:
```
Generate JUnit5 tests for ClassName with 95% coverage
```

### "No staged Java files — skipping"
```bash
git add src/main/java/...
```

---

## Upgrading

```bash
npm install -g springbootquality-check911@latest
springbootquality-check911 init
springbootquality-check911 hooks
```

---

## License

MIT © [mamidi-santhosh](https://github.com/mamidi-santhosh)
