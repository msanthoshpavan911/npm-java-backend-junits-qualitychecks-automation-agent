const fs       = require("fs");
const path     = require("path");
const readline = require("readline");
const scan     = require("./scan");

const pkgRoot = path.join(__dirname, "..");
const isWin   = process.platform === "win32";

const CHECKS = [
    { key: "checkstyle", label: "Checkstyle", desc: "Code style — Google Java Style Guide"          },
    { key: "pmd",        label: "PMD",        desc: "Code smells — unused imports, long methods"    },
    { key: "spotbugs",   label: "SpotBugs",   desc: "Bug patterns — null dereferences, open streams" },
    { key: "coverage",   label: "Coverage",   desc: "JaCoCo — minimum 95% line coverage"            },
];

function promptChecks() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        console.log("\nAvailable quality checks:");
        CHECKS.forEach((c, i) =>
            console.log(`  ${i + 1}. ${c.label.padEnd(12)} — ${c.desc}`)
        );
        console.log("");

        rl.question("Select checks to enable (e.g. 1,2,3): ", (answer) => {
            rl.close();

            const enabled = {};
            CHECKS.forEach(c => enabled[c.key] = false);

            if (answer.trim()) {
                answer.split(",")
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => n >= 1 && n <= CHECKS.length)
                    .forEach(n => { enabled[CHECKS[n - 1].key] = true; });
            }
            resolve(enabled);
        });
    });
}

function buildMcpConfig() {
    const pythonExe = isWin
        ? path.join(pkgRoot, "mcp-server", "venv", "Scripts", "python.exe")
        : path.join(pkgRoot, "mcp-server", "venv", "bin", "python");
    const serverScript      = path.join(pkgRoot, "mcp-server", "server.py");
    const junitAgentScript  = path.join(pkgRoot, "mcp-server", "junit_coverage_agent.py");
    return JSON.stringify({
        servers: {
            "springboot-architect": {
                type: "stdio",
                command: pythonExe,
                args: [serverScript],
                env: {}
            },
            "JUnit Coverage Expert": {
                type: "stdio",
                command: pythonExe,
                args: [junitAgentScript],
                env: {}
            }
        }
    }, null, 2);
}


function buildCopilotInstructions(checks) {
    const qualityLines = [
        checks.checkstyle && "- Fix Checkstyle violations (Google Java Style Guide)",
        checks.pmd        && "- Fix PMD violations (no unused imports, no methods longer than 30 lines)",
        checks.spotbugs   && "- Fix SpotBugs violations (no null dereferences, close all streams)",
        checks.coverage   && "- Ensure JaCoCo line coverage stays at or above 95%",
    ].filter(Boolean).join("\n");

    return `# Spring Boot Quality Agent

You are a Senior Spring Boot Architect embedded in this repository.

## Your Responsibilities
- Generate JUnit5 tests for every public method
${qualityLines}

## Quality Standards
${checks.checkstyle ? "- Checkstyle: Google Java Style Guide\n" : ""}\
${checks.pmd        ? "- PMD: No unused imports, no methods longer than 30 lines, meaningful names\n" : ""}\
${checks.spotbugs   ? "- SpotBugs: No null dereferences, close all streams, implement equals+hashCode together\n" : ""}\
${checks.coverage   ? "- JaCoCo: 95% minimum line coverage — enforced on every git commit\n" : ""}\

---

## JUnit Test Generation — Automated Workflow

When the user asks to generate JUnit tests for any class, execute ALL steps below autonomously.
Do NOT stop and ask the user for the file — find it yourself using the terminal.

### Step 1 — Find and read the source file

Run in terminal (Windows):
\`\`\`
dir /s /b "ClassName.java" 2>nul
\`\`\`
Or (Mac/Linux):
\`\`\`
find . -name "ClassName.java" -not -path "*/test/*" 2>/dev/null
\`\`\`
Then read the file:
\`\`\`
type src\\main\\java\\...\\ClassName.java
\`\`\`

### Step 2 — Analyse the class

Extract: package, class type (@Service/@RestController/@Repository), all injected fields, all public methods with parameter types.

### Step 3 — Generate a complete JUnit 5 test file

**For @Service — use @ExtendWith(MockitoExtension.class) + @Mock + @InjectMocks:**
\`\`\`java
@ExtendWith(MockitoExtension.class)
class ClassNameTest {

    @Mock private SomeRepository repo;
    @InjectMocks private ClassName service;

    @BeforeEach void setUp() {
        lenient().when(repo.findById(any())).thenReturn(Optional.of(mock(Entity.class)));
        lenient().when(repo.findAll()).thenReturn(Collections.singletonList(mock(Entity.class)));
        lenient().when(repo.save(any())).thenReturn(mock(Entity.class));
        lenient().when(repo.existsById(any())).thenReturn(true);
    }

    @Test void methodName_happyPath() { assertNotNull(service.method(1L)); }
    @Test void methodName_notFound_throws() {
        when(repo.findById(any())).thenReturn(Optional.empty());
        assertThrows(Exception.class, () -> service.method(999L));
    }
}
\`\`\`

**Argument rules — NEVER pass null:**
| Type | Use |
|---|---|
| long/Long | 1L |
| int/Integer | 1 |
| String | "test" |
| boolean | true |
| Domain/DTO class | mock(ClassName.class) |
| List | Collections.emptyList() |

For each public method: happy-path test + exception/not-found test + null/boundary test.
For @RestController: use @WebMvcTest + MockMvc. For @Repository: use @DataJpaTest.

### Step 4 — Write the test file

Test path = replace \`src/main/java\` with \`src/test/java\` and add \`Test\` before \`.java\`.
Write the full file using editFiles tool.

### Step 5 — Run tests and measure coverage

\`\`\`
mvn test jacoco:report -Dtest=ClassNameTest --no-transfer-progress -q
\`\`\`
Then read coverage:
\`\`\`
type target\\site\\jacoco\\jacoco.xml
\`\`\`
Find: \`<counter type="LINE" missed="X" covered="Y"/>\`
Coverage = Y / (X + Y) * 100

### Step 6 — Iterate until 95%+ (up to 5 rounds)

1. Read back the test file with terminal
2. Add tests for every uncovered branch (exception paths, null checks, else blocks, empty lists)
3. Rewrite the FULL test file (never partial patches)
4. Re-run Maven and re-read jacoco.xml
5. Stop when LINE coverage >= 95%

### Non-negotiable rules
- NEVER use assertDoesNotThrow — fails on any exception
- NEVER pass null for Long/String/domain objects
- ALWAYS use lenient() in @BeforeEach
- ALWAYS write the complete test file on each iteration
`;
}

const controllerInstructions = `---
applyTo: "**/*Controller.java"
---
# Controller Layer

- Annotate with \`@RestController\` and \`@RequestMapping\`
- Keep controllers thin — HTTP handling only, delegate logic to services
- Validate inputs with \`@Valid\` on method parameters
- Return \`ResponseEntity<T>\` for full HTTP response control
- Test with \`@WebMvcTest\` and \`MockMvc\` — do NOT load full context
`;

const serviceInstructions = `---
applyTo: "**/*Service.java"
---
# Service Layer

- Annotate with \`@Service\`
- Use constructor injection only — no \`@Autowired\` on fields
- Mark transactional methods with \`@Transactional\`
- Throw domain-specific exceptions, not generic RuntimeException
- Test with \`@ExtendWith(MockitoExtension.class)\` — mock all repositories
`;

const testInstructions = `---
applyTo: "**/test/**/*.java"
---
# Test Standards

- JUnit5 (\`@Test\`, \`@BeforeEach\`, \`@ParameterizedTest\`)
- Mockito (\`@Mock\`, \`@InjectMocks\`, \`when().thenReturn()\`, \`verify()\`)
- One assertion focus per test method
- Target 95% line coverage — JaCoCo enforces this on commit
- Use \`@BeforeEach\` for shared setup to avoid duplication
`;

module.exports = async function init() {

    console.log("Initializing Spring Boot Quality Agent...");

    const checks = await promptChecks();

    const enabledNames = CHECKS.filter(c => checks[c.key]).map(c => c.label);
    console.log(`\nEnabled checks: ${enabledNames.length ? enabledNames.join(", ") : "none"}`);

    fs.writeFileSync(
        ".quality-agent.json",
        JSON.stringify({ checks }, null, 2)
    );

    fs.mkdirSync("docs", { recursive: true });
    fs.mkdirSync(".github/instructions", { recursive: true });
    fs.mkdirSync(".vscode", { recursive: true });

    fs.writeFileSync(
        path.join(".github", "copilot-instructions.md"),
        buildCopilotInstructions(checks)
    );

    fs.writeFileSync(
        path.join(".github", "instructions", "controller.instructions.md"),
        controllerInstructions
    );

    fs.writeFileSync(
        path.join(".github", "instructions", "service.instructions.md"),
        serviceInstructions
    );

    fs.writeFileSync(
        path.join(".github", "instructions", "test.instructions.md"),
        testInstructions
    );

    fs.writeFileSync(
        path.join(".github", "instructions", "springbootquality-check911.md"),
        "# Spring Boot Quality Agent\nSee .github/copilot-instructions.md for full guidelines.\n"
    );

    fs.writeFileSync(path.join(".vscode", "mcp.json"), buildMcpConfig());

    console.log("\nScanning project and generating architecture docs...");
    scan();

    console.log("\nProject initialized successfully");
    console.log("  Quality config       : .quality-agent.json");
    console.log("  Copilot instructions : .github/copilot-instructions.md");
    console.log("  Scoped instructions  : .github/instructions/");
    console.log("  MCP server config    : .vscode/mcp.json");
    console.log("  Architecture doc     : docs/architecture.md  (generated from your project)");
    console.log("  Repository index     : docs/repository-index.md");
    console.log("");
    console.log("How to generate JUnit tests with 95% coverage:");
    console.log("  1. Open Copilot Chat  (Ctrl+Alt+I)");
    console.log("  2. Switch to 'Agent' mode (dropdown at bottom-left of chat input)");
    console.log("  3. Type: Generate JUnit5 tests for <YourClassName> with 95% coverage");
    console.log("     Copilot finds the file, writes tests, runs Maven, and iterates automatically.");
    console.log("");
    console.log("Next step:");
    console.log("  springbootquality-check911 hooks  — set up git hooks");
};
