import os
import subprocess
import xml.etree.ElementTree as ET

def get_changed_java_files():
    cmds = [
        # Files changed in the last commit only
        ["git", "diff-tree", "--no-commit-id", "-r", "--name-only", "HEAD"],
        # Fallback: diff between last two commits
        ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
        # Fallback: staged files
        ["git", "diff", "--cached", "--name-only"],
    ]
    for cmd in cmds:
        result = subprocess.run(cmd, capture_output=True, text=True)
        files = [f.strip() for f in result.stdout.splitlines() if f.strip().endswith(".java")]
        if files:
            return files
    return []

def is_production_file(f):
    return "/test/" not in f.replace("\\", "/")

def simple_class(f):
    return os.path.basename(f).replace(".java", "")

def coverage_checker():

    report_path = "target/site/jacoco/jacoco.xml"

    if not os.path.exists(report_path):
        return "JaCoCo report not found. Run 'mvn clean test jacoco:report' first."

    changed    = get_changed_java_files()
    production = [f for f in changed if is_production_file(f)]

    if not production:
        return "No changed production Java files — skipping coverage check."

    changed_names = {simple_class(f) for f in production}

    tree = ET.parse(report_path)
    root = tree.getroot()

    results        = []
    overall_covered = 0
    overall_missed  = 0

    for cls in root.findall(".//class"):
        short_name = cls.attrib.get("name", "").split("/")[-1]

        if short_name not in changed_names:
            continue

        for counter in cls.findall("counter"):
            if counter.attrib.get("type") != "LINE":
                continue

            covered = int(counter.attrib["covered"])
            missed  = int(counter.attrib["missed"])
            total   = covered + missed

            if total == 0:
                continue

            pct    = covered / total * 100
            status = "✅" if pct >= 95 else "❌"
            results.append(f"{status} {short_name}: {pct:.1f}%")
            overall_covered += covered
            overall_missed  += missed

    if not results:
        return "No coverage data found for changed production files."

    total   = overall_covered + overall_missed
    overall = (overall_covered / total * 100) if total > 0 else 0
    status  = "PASS" if overall >= 95 else "FAIL"

    return "\n".join([
        "Coverage (changed files only):",
        "",
        *results,
        "",
        f"Overall: {overall:.2f}%",
        f"Status:  {status}"
    ])
