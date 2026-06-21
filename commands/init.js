const fs = require("fs");
const path = require("path");

const pkgRoot = path.join(__dirname, "..");
const isWin = process.platform === "win32";

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

const copilotInstructions = `# Spring Boot Quality Agent

You are a Senior Spring Boot Architect embedded in this repository.

## Your Responsibilities
- Generate JUnit5 tests for every public method
- Fix Checkstyle, PMD, and SpotBugs violations
- Ensure JaCoCo line coverage stays at or above 95%
- Use Mockito to mock all dependencies in tests

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
- Checkstyle: Google Java Style Guide
- PMD: No unused imports, no methods longer than 30 lines, meaningful names
- SpotBugs: No null dereferences, close all streams, implement equals+hashCode together
- JaCoCo: 95% minimum line coverage — enforced on every git push
`;

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
- Target 95% line coverage — JaCoCo enforces this on push
- Use \`@BeforeEach\` for shared setup to avoid duplication
`;

module.exports = function init() {

    console.log("Initializing project...");

    fs.mkdirSync("docs", { recursive: true });
    fs.mkdirSync(".github/instructions", { recursive: true });
    fs.mkdirSync(".vscode", { recursive: true });

    fs.writeFileSync(
        path.join("docs", "repository-index.md"),
        "# Repository Index\n"
    );

    fs.writeFileSync(
        path.join("docs", "architecture.md"),
        "# Architecture\n"
    );

    fs.writeFileSync(
        path.join(".github", "copilot-instructions.md"),
        copilotInstructions
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

    fs.writeFileSync(
        path.join(".vscode", "mcp.json"),
        buildMcpConfig()
    );

    console.log("Project initialized successfully");
    console.log("  Copilot instructions : .github/copilot-instructions.md");
    console.log("  Scoped instructions  : .github/instructions/");
    console.log("  MCP server config    : .vscode/mcp.json");
    console.log("");
    console.log("Next steps:");
    console.log("  1. springbootquality-check911 scan   — index your Java files");
    console.log("  2. springbootquality-check911 hooks  — set up git hooks");
};
