const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function getChangedJavaFiles() {
    const cmds = [
        // Files changed in the last commit only
        "git diff-tree --no-commit-id -r --name-only HEAD",
        // Fallback: diff between last two commits
        "git diff --name-only HEAD~1 HEAD",
        // Fallback: staged files (pre-commit scenario)
        "git diff --cached --name-only"
    ];
    for (const cmd of cmds) {
        try {
            const out = execSync(cmd, { encoding: "utf8", shell: true });
            const files = out.split("\n").map(f => f.trim()).filter(f => f.endsWith(".java"));
            if (files.length) return files;
        } catch (_) {}
    }
    return [];
}

function isProductionFile(f) {
    return !f.replace(/\\/g, "/").includes("/test/");
}

function toSimpleClass(f) {
    return path.basename(f).replace(".java", "");
}

function parseCoverage(productionFiles) {
    const reportPath = "target/site/jacoco/jacoco.xml";
    if (!fs.existsSync(reportPath)) {
        return { error: "JaCoCo report not found at target/site/jacoco/jacoco.xml" };
    }

    const xml     = fs.readFileSync(reportPath, "utf8");
    const results = [];

    for (const file of productionFiles) {
        const className = toSimpleClass(file);

        // Match the exact <class> block for this file
        const classRe = new RegExp(
            `<class name="[^"]*/${className}"[^>]*>[\\s\\S]*?</class>`, "g"
        );
        const classMatch = classRe.exec(xml);
        if (!classMatch) continue;

        // JaCoCo XML has LINE counters at method level AND class level.
        // The LAST <counter type="LINE"> inside the class block is the class-level aggregate.
        const lineMatches = [
            ...classMatch[0].matchAll(
                /<counter type="LINE" missed="(\d+)" covered="(\d+)"/g
            )
        ];
        if (!lineMatches.length) continue;

        const last    = lineMatches[lineMatches.length - 1];
        const missed  = parseInt(last[1]);
        const covered = parseInt(last[2]);
        const total   = missed + covered;
        if (total === 0) continue;

        const pct    = (covered / total) * 100;
        const status = pct >= 95 ? "✅" : "❌";
        results.push({
            className,
            pct,
            passed: pct >= 95,
            label: `${status} ${className}: ${pct.toFixed(1)}%`
        });
    }

    return { results };
}

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(".quality-agent.json", "utf8")).checks || {};
    } catch (_) {
        return { coverage: true };
    }
}

module.exports = function coverage() {

    const checks = loadConfig();
    if (checks.coverage === false) {
        console.log("Coverage check disabled — skipping.");
        return;
    }

    const changed    = getChangedJavaFiles();
    const production = changed.filter(isProductionFile);

    if (!production.length) {
        console.log("No changed production Java files — skipping coverage check.");
        return;
    }

    const names          = production.map(toSimpleClass);
    // e.g. "OrderService*,OrderController*" — catches Test, IT, IntegrationTest variants
    const testPatterns   = names.map(n => `${n}*`).join(",");
    // e.g. "**/OrderService.class,**/OrderController.class"
    // Tells JaCoCo agent to instrument ONLY these classes → report contains only these classes
    const jacocoIncludes = names.map(n => `**/${n}.class`).join(",");

    console.log(`Changed files : ${names.join(", ")}`);
    console.log(`Running tests : ${testPatterns}`);

    // Step 1: Run only tests for changed files; instrument only changed classes
    try {
        execSync(
            `mvn clean test -Dtest="${testPatterns}" -DfailIfNoTests=false -Djacoco.includes="${jacocoIncludes}"`,
            { stdio: "inherit", shell: true }
        );
    } catch (_) {
        console.log("\nTests failed — fix failing tests before pushing.");
        process.exit(1);
    }

    // Step 2: Generate JaCoCo report scoped to changed classes only
    // Direct goal call — no lifecycle, so jacoco:check from pom.xml never runs
    try {
        execSync(
            `mvn jacoco:report -Djacoco.includes="${jacocoIncludes}"`,
            { stdio: "inherit", shell: true }
        );
    } catch (_) {
        console.log("\nFailed to generate JaCoCo report.");
        process.exit(1);
    }

    // Step 3: Parse report for changed production files only
    const { error, results } = parseCoverage(production);

    if (error) {
        console.log(`\n${error}`);
        process.exit(1);
    }

    if (!results.length) {
        console.log("\nNo coverage data found for changed files.");
        return;
    }

    console.log("\n--- Coverage (changed files only) ---");
    results.forEach(r => console.log(`  ${r.label}`));

    const failed = results.filter(r => !r.passed);
    if (failed.length) {
        console.log(`\n${failed.length} file(s) below 95% coverage.`);
        console.log("Fix with GitHub Copilot — open Copilot Chat and ask:");
        console.log("  'Generate JUnit5 tests to reach 95% coverage for my changed files'");
        process.exit(1);
    }

    console.log("\n✅ Coverage verified for all changed files.");
};
