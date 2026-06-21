const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const pkgRoot = path.join(__dirname, "..");
const mcpDir = path.join(pkgRoot, "mcp-server");
const venvDir = path.join(mcpDir, "venv");
const requirementsPath = path.join(mcpDir, "requirements.txt");
const isWin = process.platform === "win32";

if (fs.existsSync(venvDir)) {
    process.exit(0);
}

function findPython() {
    for (const cmd of ["python", "python3"]) {
        const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
        if (r.status === 0) return cmd;
    }
    return null;
}

const python = findPython();

if (!python) {
    console.warn("[springbootquality-check911] Python not found — MCP server will be skipped.");
    console.warn("Install Python 3.9+ then run: springbootquality-check911 init");
    process.exit(0);
}

try {
    console.log("[springbootquality-check911] Setting up MCP Python environment...");
    execSync(`${python} -m venv "${venvDir}"`, { stdio: "inherit" });
    const pip = isWin
        ? path.join(venvDir, "Scripts", "pip.exe")
        : path.join(venvDir, "bin", "pip");
    execSync(`"${pip}" install -r "${requirementsPath}" --quiet`, { stdio: "inherit" });
    console.log("[springbootquality-check911] MCP server ready.");
} catch (err) {
    console.warn("[springbootquality-check911] MCP setup failed:", err.message);
    console.warn("Run 'springbootquality-check911 init' to retry.");
}
