import os
import subprocess

def get_staged_java_files():
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        capture_output=True, text=True
    )
    return [f.strip() for f in result.stdout.splitlines() if f.strip().endswith(".java")]

def to_class(f):
    normalized = f.replace("\\", "/")
    for prefix in ["src/main/java/", "src/test/java/"]:
        if normalized.startswith(prefix):
            return normalized[len(prefix):].replace("/", ".").replace(".java", "")
    return None

def run_maven(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    return result.returncode == 0, output

def violations_for_staged(output, short_names):
    return [
        l for l in output.splitlines()
        if l.strip() and any(n in l for n in short_names)
    ]

def quality_scanner():

    staged = get_staged_java_files()

    if not staged:
        return "No staged Java files — skipping quality checks."

    names       = [os.path.basename(f) for f in staged]
    short_names = [n.replace(".java", "") for n in names]   # PMD/Checkstyle output has no .java
    classes     = ",".join(filter(None, (to_class(f) for f in staged)))

    results = []

    # Checkstyle — full scan, filter output to staged files
    # (avoids -Dcheckstyle.includes silently matching 0 files → false pass)
    passed, output = run_maven("mvn checkstyle:check")
    if passed:
        results.append("✅ Checkstyle Passed")
    else:
        violations = violations_for_staged(output, short_names)
        if violations:
            results.append("❌ Checkstyle Failed\n" + "\n".join(violations))
        else:
            results.append("✅ Checkstyle Passed (no violations in staged files)")

    # PMD — full scan, filter output to staged files
    # PMD output format: "PrinterController:45 Rule:..." — no .java extension
    passed, output = run_maven("mvn pmd:check")
    if passed:
        results.append("✅ PMD Passed")
    else:
        violations = violations_for_staged(output, short_names)
        if violations:
            results.append("❌ PMD Failed\n" + "\n".join(violations))
        else:
            results.append("✅ PMD Passed (no violations in staged files)")

    # SpotBugs — -Dspotbugs.onlyAnalyze works reliably, keep targeted approach
    sb_cmd = f"mvn spotbugs:check -Dspotbugs.onlyAnalyze=\"{classes}\"" if classes else "mvn spotbugs:check"
    passed, output = run_maven(sb_cmd)
    if passed:
        results.append("✅ SpotBugs Passed")
    else:
        violations = violations_for_staged(output, short_names)
        detail = "\n".join(violations) if violations else "\n".join(
            l for l in output.splitlines() if "[ERROR]" in l or "BUG" in l
        )
        results.append(f"❌ SpotBugs Failed\n{detail}")

    return "\n\n".join(results)
