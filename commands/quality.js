const { execSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const PKG_ROOT       = path.join(__dirname, "..");
const CHECKSTYLE_XML = path.join(PKG_ROOT, "config", "checkstyle.xml");
const PMD_RULES_XML  = path.join(PKG_ROOT, "config", "pmd-rules.xml");

// ── git ───────────────────────────────────────────────────────────────────────

function getStagedJavaFiles() {
    try {
        // Staged files first (git add / terminal workflow)
        const staged = execSync("git diff --cached --name-only", { encoding: "utf8" });
        const stagedFiles = staged.split("\n").map(f => f.trim()).filter(f => f.endsWith(".java"));
        if (stagedFiles.length) return stagedFiles;

        // Fall back to modified-but-unstaged files (IntelliJ commit dialog workflow)
        const modified = execSync("git diff --name-only", { encoding: "utf8" });
        return modified.split("\n").map(f => f.trim()).filter(f => f.endsWith(".java"));
    } catch (_) { return []; }
}

// Parse staged diff to find exactly which line ranges were added/modified.
// Returns: { "src/main/java/.../Foo.java": [[startLine, endLine], ...] }
function getChangedLineRanges() {
    try {
        // Use staged diff if available, otherwise fall back to unstaged diff
        let diff = execSync("git diff --cached --unified=0", { encoding: "utf8" });
        if (!diff.trim()) diff = execSync("git diff --unified=0", { encoding: "utf8" });
        const ranges = {};
        let cur = null;

        for (const line of diff.split("\n")) {
            // +++ b/src/main/java/com/example/PrinterController.java
            const fileM = /^\+\+\+ b\/(.+)$/.exec(line);
            if (fileM) {
                cur = fileM[1]; // git-relative path with forward slashes
                if (!ranges[cur]) ranges[cur] = [];
                continue;
            }
            if (line.startsWith("+++ /dev/null")) { cur = null; continue; }

            // @@ -oldStart[,oldCount] +newStart[,newCount] @@
            const hunkM = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
            if (hunkM && cur) {
                const start = parseInt(hunkM[1]);
                const count = hunkM[2] !== undefined ? parseInt(hunkM[2]) : 1;
                if (count > 0) ranges[cur].push([start, start + count - 1]);
                // count === 0 → pure deletion, no new lines to check
            }
        }
        return ranges;
    } catch (_) { return {}; }
}

function toClass(f) {
    const n = f.replace(/\\/g, "/");
    for (const p of ["src/main/java/", "src/test/java/"]) {
        if (n.startsWith(p)) return n.slice(p.length).replace(/\//g, ".").replace(/\.java$/, "");
    }
    return null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function attr(str, name) {
    const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(str);
    return m ? m[1] : null;
}

// Find the changed ranges for an absolute or relative file path reported by Maven/SpotBugs.
// changedRanges keys are git-relative paths (forward slashes).
function findRanges(absOrRelPath, changedRanges) {
    const norm = absOrRelPath.replace(/\\/g, "/").toLowerCase();
    for (const [gitPath, ranges] of Object.entries(changedRanges)) {
        const gn = gitPath.toLowerCase();
        if (norm === gn || norm.endsWith("/" + gn)) return ranges;
    }
    return null;
}

// Is the reported line inside any changed hunk?
function inChangedRange(lineStr, ranges) {
    if (!ranges) return false;
    const n = parseInt(lineStr);
    if (isNaN(n)) return false;
    return ranges.some(([s, e]) => n >= s && n <= e);
}

function clean(p) { try { fs.unlinkSync(p); } catch (_) {} }

// Copy our configs into target/ so Maven resolves them by relative path —
// avoids absolute-path quoting problems and pom.xml configLocation override.
function deployConfigs() {
    fs.mkdirSync("target", { recursive: true });
    fs.copyFileSync(CHECKSTYLE_XML, "target/sq-checkstyle.xml");
    fs.copyFileSync(PMD_RULES_XML,  "target/sq-pmd-rules.xml");
}

function mvnSilent(cmd) {
    try {
        execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], shell: true });
    } catch (_) {}
}

// ── XML parsers (chunk-filtered) ──────────────────────────────────────────────

function parseCheckstyleXml(changedRanges) {
    const xmlPath = "target/checkstyle-result.xml";
    if (!fs.existsSync(xmlPath)) return null;

    const xml   = fs.readFileSync(xmlPath, "utf8");
    const viols = [];

    const fileRe = /<file name="([^"]*)">([\s\S]*?)<\/file>/g;
    let fm;
    while ((fm = fileRe.exec(xml)) !== null) {
        const ranges = findRanges(fm[1], changedRanges);
        if (!ranges) continue;                   // file not staged
        const fname = path.basename(fm[1]);

        const errRe = /<error\b([^/]*)\s*\/>/g;
        let em;
        while ((em = errRe.exec(fm[2])) !== null) {
            const line = attr(em[1], "line") || "?";
            if (!inChangedRange(line, ranges)) continue; // outside changed chunk
            const msg = attr(em[1], "message") || "violation";
            viols.push(`  [Checkstyle] ${fname}:${line} — ${msg}`);
        }
    }
    return viols;
}

function parsePmdXml(changedRanges) {
    const xmlPath = "target/pmd.xml";
    if (!fs.existsSync(xmlPath)) return null;

    const xml   = fs.readFileSync(xmlPath, "utf8");
    const viols = [];

    const fileRe = /<file name="([^"]*)">([\s\S]*?)<\/file>/g;
    let fm;
    while ((fm = fileRe.exec(xml)) !== null) {
        const ranges = findRanges(fm[1], changedRanges);
        if (!ranges) continue;
        const fname = path.basename(fm[1]);

        const violRe = /<violation\b([^>]*)>([\s\S]*?)<\/violation>/g;
        let vm;
        while ((vm = violRe.exec(fm[2])) !== null) {
            const line = attr(vm[1], "beginline") || "?";
            if (!inChangedRange(line, ranges)) continue; // outside changed chunk
            const rule = attr(vm[1], "rule") || "?";
            const msg  = vm[2].trim();
            viols.push(`  [PMD:${rule}] ${fname}:${line} — ${msg}`);
        }
    }
    return viols;
}

function parseSpotbugsXml(changedRanges) {
    const candidates = ["target/spotbugsXml.xml", "target/spotbugs.xml"];
    const xmlPath    = candidates.find(c => fs.existsSync(c));
    if (!xmlPath) return null;

    const xml   = fs.readFileSync(xmlPath, "utf8");
    const viols = [];

    const bugRe = /<BugInstance\b([^>]*)>([\s\S]*?)<\/BugInstance>/g;
    let bm;
    while ((bm = bugRe.exec(xml)) !== null) {
        const bugType = attr(bm[1], "type") || "?";
        const body    = bm[2];

        const srcMatch = /sourcefile="([^"]*\.java)"/.exec(body);
        if (!srcMatch) continue;

        const srcFile = srcMatch[1]; // "PrinterController.java"

        // Find ranges by matching filename suffix in changedRanges keys
        const entry = Object.entries(changedRanges).find(([gitPath]) => {
            const gn = gitPath.toLowerCase();
            const fn = srcFile.toLowerCase();
            return gn.endsWith("/" + fn) || gn === fn;
        });
        if (!entry) continue;

        const lineMatch = /start="(\d+)"/.exec(body);
        const line      = lineMatch ? lineMatch[1] : "?";
        if (!inChangedRange(line, entry[1])) continue; // outside changed chunk

        const msgMatch = /<LongMessage>([\s\S]*?)<\/LongMessage>/.exec(body);
        const msg = msgMatch ? msgMatch[1].trim() : bugType;
        viols.push(`  [SpotBugs:${bugType}] ${srcFile}:${line} — ${msg}`);
    }
    return viols;
}

// ── config ────────────────────────────────────────────────────────────────────

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(".quality-agent.json", "utf8")).checks || {};
    } catch (_) {
        return {};
    }
}

// ── main export ───────────────────────────────────────────────────────────────

module.exports = function quality() {

    const checks = loadConfig();
    const anyEnabled = checks.checkstyle || checks.pmd || checks.spotbugs;
    if (!anyEnabled) {
        console.log("No quality checks enabled — run 'springbootquality-check911 init' to configure.");
        return;
    }

    const staged = getStagedJavaFiles();
    if (!staged.length) {
        console.log("No staged Java files — skipping quality checks.");
        return;
    }

    const changedRanges = getChangedLineRanges();
    const names   = staged.map(f => path.basename(f));
    const classes = staged.map(toClass).filter(Boolean).join(",");

    console.log(`Checking changed chunks in: ${names.join(", ")}\n`);

    deployConfigs();

    const results = [];
    let failed    = false;

    // ── Checkstyle ────────────────────────────────────────────────────────────
    if (checks.checkstyle) {
        process.stdout.write("Running Checkstyle... ");
        clean("target/checkstyle-result.xml");
        mvnSilent(`mvn checkstyle:checkstyle -Dcheckstyle.config.location="target/sq-checkstyle.xml"`);
        const csViols = parseCheckstyleXml(changedRanges);
        if (csViols === null) {
            console.log("⚠️");
            results.push("⚠️  Checkstyle: report not generated (add maven-checkstyle-plugin to pom.xml)");
        } else if (csViols.length) {
            console.log("❌");
            csViols.forEach(v => console.log(v));
            results.push(`❌ Checkstyle: ${csViols.length} violation(s) in your changed lines`);
            failed = true;
        } else {
            console.log("✅");
            results.push("✅ Checkstyle passed");
        }
    }

    // ── PMD ───────────────────────────────────────────────────────────────────
    if (checks.pmd) {
        process.stdout.write("Running PMD...        ");
        clean("target/pmd.xml");
        mvnSilent(`mvn pmd:pmd -Dpmd.rulesets="target/sq-pmd-rules.xml"`);
        const pmdViols = parsePmdXml(changedRanges);
        if (pmdViols === null) {
            console.log("⚠️");
            results.push("⚠️  PMD: report not generated (add maven-pmd-plugin to pom.xml)");
        } else if (pmdViols.length) {
            console.log("❌");
            pmdViols.forEach(v => console.log(v));
            results.push(`❌ PMD: ${pmdViols.length} violation(s) in your changed lines`);
            failed = true;
        } else {
            console.log("✅");
            results.push("✅ PMD passed");
        }
    }

    // ── SpotBugs ──────────────────────────────────────────────────────────────
    if (checks.spotbugs) {
        process.stdout.write("Running SpotBugs...   ");
        mvnSilent("mvn compile -q");
        clean("target/spotbugsXml.xml");
        const sbCmd = classes
            ? `mvn spotbugs:spotbugs -Dspotbugs.onlyAnalyze="${classes}" -Dspotbugs.xmlOutput=true`
            : "mvn spotbugs:spotbugs -Dspotbugs.xmlOutput=true";
        mvnSilent(sbCmd);
        const sbViols = parseSpotbugsXml(changedRanges);
        if (sbViols === null) {
            console.log("⚠️");
            results.push("⚠️  SpotBugs: report not generated (add spotbugs-maven-plugin to pom.xml)");
        } else if (sbViols.length) {
            console.log("❌");
            sbViols.forEach(v => console.log(v));
            results.push(`❌ SpotBugs: ${sbViols.length} violation(s) in your changed lines`);
            failed = true;
        } else {
            console.log("✅");
            results.push("✅ SpotBugs passed");
        }
    }

    console.log("\n--- Quality Summary ---");
    results.forEach(r => console.log(r));

    if (failed) {
        console.log("\nFix with GitHub Copilot — open Copilot Chat and ask:");
        console.log("  'Fix the quality violations in my staged files'");
        process.exit(1);
    }

    console.log("\nAll quality checks passed.");
};
