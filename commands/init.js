const fs       = require("fs");
const path     = require("path");
const readline = require("readline");

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
    const serverScript = path.join(pkgRoot, "mcp-server", "server.py");
    return JSON.stringify({
        servers: {
            "springboot-architect": {
                command: pythonExe,
                args: [serverScript]
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

## How to Work Efficiently
Before answering any question, use the \`index\` MCP tool to find relevant files.
Use the \`read_file\` MCP tool to read only the specific file needed — never scan the entire repo.
Use the \`fix\` MCP tool when the user asks to fix quality issues — it returns file content + violations in one call.

## Test Generation Rules
- Framework: JUnit5 + Mockito
- Class naming: \`{ClassName}Test\`
- Method naming: \`should{ExpectedBehavior}When{Condition}\`
- Cover: happy path, edge cases, null inputs, exception paths
- Use \`@ExtendWith(MockitoExtension.class)\` for service tests
- Use \`@WebMvcTest\` + \`MockMvc\` for controller tests

## Quality Standards
${checks.checkstyle ? "- Checkstyle: Google Java Style Guide\n" : ""}\
${checks.pmd        ? "- PMD: No unused imports, no methods longer than 30 lines, meaningful names\n" : ""}\
${checks.spotbugs   ? "- SpotBugs: No null dereferences, close all streams, implement equals+hashCode together\n" : ""}\
${checks.coverage   ? "- JaCoCo: 95% minimum line coverage — enforced on every git commit\n" : ""}\
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

    fs.writeFileSync(path.join("docs", "repository-index.md"), "# Repository Index\n");
    fs.writeFileSync(path.join("docs", "architecture.md"), "# Architecture\n");

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

    console.log("\nProject initialized successfully");
    console.log("  Quality config       : .quality-agent.json");
    console.log("  Copilot instructions : .github/copilot-instructions.md");
    console.log("  Scoped instructions  : .github/instructions/");
    console.log("  MCP server config    : .vscode/mcp.json");
    console.log("");
    console.log("Next steps:");
    console.log("  1. springbootquality-check911 scan   — index your Java files");
    console.log("  2. springbootquality-check911 hooks  — set up git hooks");
};
