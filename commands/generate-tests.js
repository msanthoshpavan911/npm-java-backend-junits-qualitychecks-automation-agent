"use strict";

const { execSync } = require("child_process");
const fs       = require("fs");
const path     = require("path");
const readline = require("readline");

const THRESHOLD = 95;

// ── helpers ───────────────────────────────────────────────────────────────────

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function detectClassType(src) {
    if (/@RestController|@Controller/.test(src))                                                      return "controller";
    if (/@Repository/.test(src) || /extends\s+(?:Jpa|Crud|PagingAndSorting)Repository/.test(src))    return "repository";
    if (/@Service/.test(src))                                                                          return "service";
    return "unit";
}

function extractPackage(src) {
    const m = src.match(/^package\s+([\w.]+)\s*;/m);
    return m ? m[1] : "";
}

function extractClassName(src, filePath) {
    const m = src.match(/public\s+(?:class|interface|enum)\s+(\w+)/);
    return m ? m[1] : path.basename(filePath, ".java");
}

function extractPublicMethods(src, className) {
    const skip = new Set(["if", "while", "for", "switch", "catch", "try", "return"]);
    const methods = [];
    const re = /public\s+(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/g;
    for (const m of src.matchAll(re)) {
        const name = m[2];
        if (name === className || skip.has(name)) continue;
        methods.push({
            returnType: m[1],
            name,
            params: m[3].split(",").map(p => p.trim()).filter(Boolean)
        });
    }
    return [...new Map(methods.map(m => [m.name, m])).values()]; // deduplicate by name
}

function extractDependencies(src) {
    const deps = [];
    for (const m of src.matchAll(/private\s+final\s+([\w<>, ]+?)\s+(\w+)\s*;/g))
        deps.push({ type: m[1].trim(), name: m[2] });
    for (const m of src.matchAll(/@Autowired[\s\S]{0,20}?private\s+([\w<>, ]+?)\s+(\w+)\s*;/g))
        if (!deps.find(d => d.name === m[2])) deps.push({ type: m[1].trim(), name: m[2] });
    return deps;
}

function extractRequestMappings(src) {
    const paths = [];
    for (const m of src.matchAll(/@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\([^)]*?(?:value|path)\s*=\s*["']([^"']+)["']|[^)]*?["']([^"']+)["']|\(["']([^"']+)["']\))?/g))
        paths.push(m[1] || m[2] || m[3] || "/");
    return paths;
}

function instanceName(className) {
    const stripped = className.replace(/Impl$/, "").replace(/Controller$/, "").replace(/Service$/, "");
    const base     = stripped || className;
    return base.charAt(0).toLowerCase() + base.slice(1);
}

// src/main/java/.../Foo.java  →  src/test/java/.../FooTest.java
function testFilePath(srcPath) {
    const norm = srcPath.replace(/\\/g, "/");
    if (norm.includes("src/main/java/")) {
        const tp = norm.replace("src/main/java/", "src/test/java/").replace(/\.java$/, "Test.java");
        return tp.replace(/\//g, path.sep);
    }
    return srcPath.replace(/\.java$/, "Test.java");
}

function getMavenCmd() {
    if (fs.existsSync("mvnw.cmd")) return "mvnw.cmd";
    if (fs.existsSync("mvnw"))     return "./mvnw";
    return "mvn";
}

// ── test-case builders — each returns [{ name, body }] ───────────────────────

function serviceTestCases(src, className, deps) {
    const methods  = extractPublicMethods(src, className);
    const inst     = instanceName(className);
    const cases    = [];

    for (const m of methods) {
        const isVoid   = m.returnType === "void";
        const args     = m.params.map(() => "null").join(", ");
        const mockDep  = deps[0] ? deps[0].name : null;

        cases.push({
            name: `${m.name}_shouldExecuteWithoutException`,
            body: `    @Test
    void ${m.name}_shouldExecuteWithoutException() {
        // Arrange${mockDep ? `\n        // when(${mockDep}.method(any())).thenReturn(value);` : ""}

        // Act & Assert
        assertDoesNotThrow(() -> ${inst}.${m.name}(${args}));
    }`
        });

        if (!isVoid) {
            cases.push({
                name: `${m.name}_shouldReturnNonNullResult`,
                body: `    @Test
    void ${m.name}_shouldReturnNonNullResult() {
        // Arrange${mockDep ? `\n        // when(${mockDep}.method(any())).thenReturn(value);` : ""}

        // Act
        var result = ${inst}.${m.name}(${args});

        // Assert
        // assertNotNull(result);
    }`
            });
        }
    }

    return cases;
}

function controllerTestCases(src, className) {
    const mappings = extractRequestMappings(src);
    const methods  = extractPublicMethods(src, className);
    const cases    = [];

    for (const m of methods) {
        const path = mappings.shift() || "/api/test";
        const httpMethod = src.includes("@PostMapping") ? "post" : src.includes("@PutMapping") ? "put" : src.includes("@DeleteMapping") ? "delete" : "get";
        cases.push({
            name: `${m.name}_shouldReturn200`,
            body: `    @Test
    void ${m.name}_shouldReturn200() throws Exception {
        // Arrange
        // when(service.method()).thenReturn(value);

        // Act & Assert
        mockMvc.perform(${httpMethod}("${path}"))
               .andExpect(status().isOk());
    }`
        },
        {
            name: `${m.name}_shouldReturn400WhenInvalidRequest`,
            body: `    @Test
    void ${m.name}_shouldReturn400WhenInvalidRequest() throws Exception {
        mockMvc.perform(${httpMethod}("${path}")
                .contentType("application/json")
                .content("{}"))
               .andExpect(status().is4xxClientError());
    }`
        });
    }

    return cases;
}

function repositoryTestCases(src, className) {
    const methods = extractPublicMethods(src, className);
    const inst    = instanceName(className);
    return methods.map(m => ({
        name: `${m.name}_shouldReturnResult`,
        body: `    @Test
    void ${m.name}_shouldReturnResult() {
        // Act
        var result = ${inst}.${m.name}(${m.params.map(() => "null").join(", ")});

        // Assert
        assertNotNull(result);
    }`
    }));
}

function unitTestCases(src, className) {
    const methods = extractPublicMethods(src, className);
    const inst    = instanceName(className);
    const cases   = [];

    for (const m of methods) {
        const args    = m.params.map(() => "null").join(", ");
        const isVoid  = m.returnType === "void";
        const isStatic = src.match(new RegExp(`public\\s+static[\\s\\S]{0,30}?${m.name}\\s*\\(`));

        const call = isStatic ? `${className}.${m.name}(${args})` : `${inst}.${m.name}(${args})`;

        cases.push({
            name: `${m.name}_shouldNotThrow`,
            body: `    @Test
    void ${m.name}_shouldNotThrow() {
        assertDoesNotThrow(() -> ${call});
    }`
        });

        if (!isVoid) {
            cases.push({
                name: `${m.name}_shouldReturnNonNull`,
                body: `    @Test
    void ${m.name}_shouldReturnNonNull() {
        var result = ${call};
        assertNotNull(result);
    }`
            });
        }
    }

    return cases;
}

// ── full-file builder (new files) ─────────────────────────────────────────────

function buildFullFile(src, filePath, classType, cases) {
    const pkg       = extractPackage(src);
    const className = extractClassName(src, filePath);
    const deps      = extractDependencies(src);
    const inst      = instanceName(className);
    const body      = cases.map(c => c.body).join("\n\n");

    if (classType === "controller") {
        const mockBeans = deps.map(d => `    @MockBean\n    private ${d.type} ${d.name};`).join("\n\n");
        return `package ${pkg};

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.mockito.Mockito.*;

@WebMvcTest(${className}.class)
class ${className}Test {

    @Autowired
    private MockMvc mockMvc;

${mockBeans}

${body}
}
`;
    }

    if (classType === "repository") {
        return `package ${pkg};

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
class ${className}Test {

    @Autowired
    private ${className} ${inst};

${body}
}
`;
    }

    if (classType === "service") {
        const mocks    = deps.map(d => `    @Mock\n    private ${d.type} ${d.name};`).join("\n\n");
        return `package ${pkg};

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@ExtendWith(MockitoExtension.class)
class ${className}Test {

${mocks}

    @InjectMocks
    private ${className} ${inst};

${body}
}
`;
    }

    // unit
    return `package ${pkg};

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ${className}Test {

    private final ${className} ${inst} = new ${className}();

${body}
}
`;
}

// ── existing-file modifier ────────────────────────────────────────────────────

function getExistingTestNames(content) {
    const names = new Set();
    // match `void methodName(` preceded by @Test (with optional whitespace/annotations between)
    for (const m of content.matchAll(/@Test[\s\S]{0,80}?void\s+(\w+)\s*\(/g))
        names.add(m[1]);
    return names;
}

function injectCases(existingContent, newCases) {
    const injection = "\n" + newCases.map(c => c.body).join("\n\n") + "\n";
    // find the last `}` — closing of the test class
    const lastBrace = existingContent.lastIndexOf("}");
    if (lastBrace === -1)
        return existingContent.trimEnd() + "\n" + injection + "\n}\n";
    return existingContent.slice(0, lastBrace) + injection + "}\n";
}

// ── coverage ──────────────────────────────────────────────────────────────────

function runMavenTest(className) {
    const mvn = getMavenCmd();
    try {
        execSync(`${mvn} test -Dtest=${className}Test --no-transfer-progress -q`, {
            encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
        });
        return { passed: true };
    } catch (e) {
        const out = ((e.stdout || "") + (e.stderr || ""))
            .split("\n").filter(l => /ERROR|FAIL|BUILD FAILURE/.test(l)).slice(0, 6).join("\n");
        return { passed: false, output: out };
    }
}

function readJacocoCoverage(pkg, className) {
    const xmlPath = path.join("target", "site", "jacoco", "jacoco.xml");
    if (!fs.existsSync(xmlPath)) return null;
    try {
        const xml       = fs.readFileSync(xmlPath, "utf8");
        const classKey  = pkg.replace(/\./g, "/") + "/" + className;
        const classM    = xml.match(new RegExp(`<class name="${classKey}"[^>]*>([\\s\\S]*?)<\\/class>`));
        if (!classM) return null;
        const lineM     = classM[1].match(/<counter type="LINE" missed="(\d+)" covered="(\d+)"/);
        if (!lineM) return null;
        const missed    = parseInt(lineM[1]);
        const covered   = parseInt(lineM[2]);
        const total     = missed + covered;
        return total > 0 ? Math.round((covered / total) * 100) : 0;
    } catch (_) { return null; }
}

function generateJacocoReport() {
    try {
        execSync(`${getMavenCmd()} jacoco:report --no-transfer-progress -q`, {
            encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
        });
    } catch (_) {}
}

// ── main ──────────────────────────────────────────────────────────────────────

module.exports = async function generateTests(filePath) {
    if (!filePath) {
        filePath = await ask("\nEnter the Java file path to generate tests for\n(e.g. src/main/java/com/example/service/UserService.java): ");
    }
    if (!filePath) { console.error("No file path provided."); process.exit(1); }

    filePath = filePath.replace(/^['"]|['"]$/g, "").trim();
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    if (!filePath.endsWith(".java")) { console.error("File must be a .java file."); process.exit(1); }

    if (!fs.existsSync("pom.xml")) {
        console.error("No pom.xml found — run from your Maven project root.");
        process.exit(1);
    }

    const src       = fs.readFileSync(filePath, "utf8");
    const classType = detectClassType(src);
    const className = extractClassName(src, filePath);
    const pkg       = extractPackage(src);
    const deps      = extractDependencies(src);
    const outPath   = testFilePath(filePath);
    const exists    = fs.existsSync(outPath);

    console.log(`\nSource:    ${filePath}`);
    console.log(`Type:      ${classType}  |  Class: ${className}  |  Package: ${pkg}`);
    console.log(`Tests:     ${outPath}  (${exists ? "exists — will add missing cases" : "will be created"})\n`);

    // build all candidate test cases
    let allCases;
    if (classType === "controller") allCases = controllerTestCases(src, className);
    else if (classType === "service")    allCases = serviceTestCases(src, className, deps);
    else if (classType === "repository") allCases = repositoryTestCases(src, className);
    else                                 allCases = unitTestCases(src, className);

    if (!allCases.length) {
        console.log("⚠️  No public methods found to generate tests for.");
        console.log("   Add public methods to the class and re-run.");
        return;
    }

    if (!exists) {
        // ── CREATE ────────────────────────────────────────────────────────────
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, buildFullFile(src, filePath, classType, allCases));
        console.log(`✅ Created: ${outPath}  (${allCases.length} test methods)`);
    } else {
        // ── MODIFY ───────────────────────────────────────────────────────────
        const existingContent = fs.readFileSync(outPath, "utf8");
        const existingNames   = getExistingTestNames(existingContent);
        const newCases        = allCases.filter(c => !existingNames.has(c.name));

        if (!newCases.length) {
            console.log("✅ All generated test methods already exist — nothing new to add.");
        } else {
            fs.writeFileSync(outPath, injectCases(existingContent, newCases));
            console.log(`✅ Modified: ${outPath}  (+${newCases.length} new test method(s) added)`);
            newCases.forEach(c => console.log(`   + ${c.name}`));
        }
    }

    // ── run tests ─────────────────────────────────────────────────────────────
    process.stdout.write("\nRunning Maven test...         ");
    const result = runMavenTest(className);

    if (!result.passed) {
        console.log("❌");
        if (result.output) console.log(result.output);
        console.log("\nSome tests failed — review the generated test file and fill in the TODOs.");
        console.log(`Run:  mvn test -Dtest=${className}Test\n`);
        return;
    }
    console.log("✅ Tests passed");

    // ── coverage ──────────────────────────────────────────────────────────────
    process.stdout.write("Reading JaCoCo coverage...    ");
    generateJacocoReport();
    const pct = readJacocoCoverage(pkg, className);

    if (pct === null) {
        console.log("⚠️  (JaCoCo report not found)");
        console.log("\nTo see coverage, ensure jacoco-maven-plugin is in pom.xml, then run:");
        console.log(`  mvn test jacoco:report -Dtest=${className}Test\n`);
        return;
    }

    const icon = pct >= THRESHOLD ? "✅" : "⚠️ ";
    console.log(`${icon} ${pct}% line coverage`);

    if (pct < THRESHOLD) {
        console.log(`\nCoverage is ${pct}% — below the ${THRESHOLD}% target.`);
        console.log("Fill in the TODO comments in the test file, then ask Copilot:");
        console.log(`  'Add more JUnit 5 tests for ${className} to reach 95% line coverage'`);
        console.log(`  'Write tests for the uncovered branches in ${className}'`);
        console.log(`\nRe-run:  mvn test jacoco:report -Dtest=${className}Test\n`);
    } else {
        console.log(`\n✅ Coverage target met. Tests are at: ${outPath}\n`);
    }
};
