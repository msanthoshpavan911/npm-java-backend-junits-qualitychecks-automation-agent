# springbootquality-check911

A developer CLI that enforces code quality and test coverage on your Spring Boot projects — automatically, on every commit.

- Runs **Checkstyle**, **PMD**, and **SpotBugs** on your staged Java files before every commit
- Enforces **95% JaCoCo line coverage** on changed files before every commit
- Configures **GitHub Copilot** with a full JUnit test generation workflow — just ask in Agent mode
- Configures an **MCP server** so Copilot can navigate and fix your project directly
- Works as a **git pre-commit hook** — no CI changes required

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18.0.0 |
| Java | >= 11 |
| Maven | >= 3.6 |
| Git | any |
| VS Code + GitHub Copilot | for AI-assisted test generation |

Your Spring Boot project must use Maven (`pom.xml`). The following Maven plugins must be configured for quality checks to work:

- `maven-checkstyle-plugin` — for Checkstyle
- `maven-pmd-plugin` — for PMD
- `spotbugs-maven-plugin` — for SpotBugs
- `jacoco-maven-plugin` — for coverage

> If a plugin is missing, the tool warns you (`⚠️`) instead of failing.

---

## Installation

```bash
npm install -g springbootquality-check911
```

---

## End-to-End Setup (First Time)

### Step 1 — Initialize

```bash
springbootquality-check911 init
```

Select which quality checks to enable:

```
Available quality checks:
  1. Checkstyle    — Code style — Google Java Style Guide
  2. PMD           — Code smells — unused imports, long methods
  3. SpotBugs      — Bug patterns — null dereferences, open streams
  4. Coverage      — JaCoCo — minimum 95% line coverage

Select checks to enable (e.g. 1,2,3):
```

After selection it creates:

| File | Purpose |
|---|---|
| `.quality-agent.json` | Stores your selected checks |
| `.github/copilot-instructions.md` | Full JUnit test generation workflow + Spring Boot guidelines for Copilot |
| `.github/instructions/controller.instructions.md` | Controller layer guidelines |
| `.github/instructions/service.instructions.md` | Service layer guidelines |
| `.github/instructions/test.instructions.md` | Test writing standards |
| `.vscode/mcp.json` | MCP server config (quality tools available to Copilot) |
| `docs/repository-index.md` | Repository index (populated by `scan`) |
| `docs/architecture.md` | Architecture doc stub |

### Step 2 — Index your Java files (optional, for Copilot)

```bash
springbootquality-check911 scan
```

### Step 3 — Install git hooks

```bash
springbootquality-check911 hooks
```

---

## Generating JUnit Tests with 95% Coverage

After running `init`, `.github/copilot-instructions.md` contains a full step-by-step test generation workflow. VS Code Copilot reads this file automatically in Agent mode.

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

> Only violations **in your changed lines** are reported — not the entire file.

---

## Using GitHub Copilot to Fix Violations

After `init`, VS Code is configured with an MCP server that gives Copilot direct access to your project's quality tools.

Press `Ctrl+Alt+I` to open Copilot Chat, switch to **Agent** mode, and use these prompts:

| What you type | What it does |
|---|---|
| `Fix the quality violations in my staged files` | Runs Checkstyle, PMD, SpotBugs on staged files — returns violations in changed lines + suggested fixes |
| `Generate JUnit5 tests for ClassName with 95% coverage` | Finds the file, generates tests, runs Maven, iterates until 95% |
| `Review my project` | Full review: impact analysis + quality checks + coverage |
| `Check coverage for my changed files` | Runs JaCoCo tests for staged files and reports per-file line coverage |
| `What files are impacted by my changes?` | Analyses git changes and identifies affected files |
| `Scan my repository` | Rebuilds the repository index |

### What Copilot knows about your project

Because `init` wrote `.github/copilot-instructions.md`, Copilot always behaves as a **Senior Spring Boot Architect** that:

- Generates JUnit 5 tests using the correct pattern for each class type
- Targets 95% minimum JaCoCo line coverage
- Uses `lenient()` stubs in `@BeforeEach` to prevent `UnnecessaryStubbingException`
- Fixes Checkstyle, PMD, and SpotBugs violations
- Navigates your codebase using MCP tools — never guesses file paths

---

## Manual Usage

### Stage your files first

```bash
git add src/main/java/com/example/OrderService.java
```

### Scan for quality violations

```bash
springbootquality-check911 quality
```

### Check test coverage

```bash
springbootquality-check911 coverage
```

---

## Quality Checks Explained

### Checkstyle
Enforces **Google Java Style Guide**: indentation, line length (100 chars), whitespace around operators, import ordering, unused imports.

### PMD
Detects **code smells**: unused imports and variables, methods longer than 30 lines, empty catch blocks, non-meaningful variable names.

### SpotBugs
Finds **bug patterns** in compiled bytecode: null dereferences, unclosed streams, missing `equals`/`hashCode`, thread safety violations.

### Coverage (JaCoCo)
Enforces **95% minimum line coverage** on changed production files. Runs only tests related to your changed files, not the full suite.

---

## Configuring Quality Checks

### First-time setup

```bash
springbootquality-check911 init
```

Select checks by number:
- `1,2,3` — Checkstyle + PMD + SpotBugs (no coverage gate)
- `1,4` — Checkstyle + Coverage only
- `1,2,3,4` — all four checks

### Changing configuration later

**Option 1 — Re-run init:**
```bash
springbootquality-check911 init
```

**Option 2 — Edit `.quality-agent.json` directly:**
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

---

## Command Reference

| Command | When to Use | What It Does |
|---|---|---|
| `init` | Once per project | Selects checks, creates config and Copilot instructions |
| `scan` | After adding new files | Indexes Java files for MCP/Copilot navigation |
| `quality` | Before committing | Scans staged files for Checkstyle, PMD, SpotBugs violations |
| `coverage` | Before committing | Checks JaCoCo coverage for staged/changed files only |
| `hooks` | Once per project | Installs pre-commit hook that auto-runs `quality` + `coverage` |

```bash
springbootquality-check911 --help
```

---

## Upgrading

```bash
npm install -g springbootquality-check911@latest
springbootquality-check911 init
springbootquality-check911 hooks
```

---

## Troubleshooting

### "No .quality-agent.json found"
Run `springbootquality-check911 init` in your Spring Boot project root.

### "⚠️ Checkstyle: report not generated"
Add `maven-checkstyle-plugin` to your `pom.xml`.

### "No staged Java files — skipping"
```bash
git add src/main/java/...
```

### Coverage blocks commit — no test file exists
Use Copilot Agent mode to generate tests first:
```
Generate JUnit5 tests for OrderService with 95% coverage
```

### Pre-commit hook not running
```bash
springbootquality-check911 hooks
git config core.hooksPath   # should output: .githooks
```

---

## License

MIT © [mamidi-santhosh](https://github.com/mamidi-santhosh)
