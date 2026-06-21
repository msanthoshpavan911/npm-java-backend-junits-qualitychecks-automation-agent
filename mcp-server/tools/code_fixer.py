import os
import re
import shutil
import subprocess
from pathlib import Path

_PKG_ROOT = Path(__file__).resolve().parent.parent.parent


# ── git ────────────────────────────────────────────────────────────────────────

def get_staged_java_files():
    r = subprocess.run(["git", "diff", "--cached", "--name-only"],
                       capture_output=True, text=True)
    return [f.strip() for f in r.stdout.splitlines() if f.strip().endswith(".java")]


def get_changed_line_ranges() -> dict:
    """Return {gitRelPath: [[startLine, endLine], ...]} for every staged hunk."""
    r = subprocess.run(["git", "diff", "--cached", "--unified=0"],
                       capture_output=True, text=True)
    ranges: dict = {}
    cur = None
    for line in r.stdout.splitlines():
        fm = re.match(r'^\+\+\+ b/(.+)$', line)
        if fm:
            cur = fm.group(1)
            ranges.setdefault(cur, [])
            continue
        if line.startswith("+++ /dev/null"):
            cur = None
            continue
        hm = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', line)
        if hm and cur:
            start = int(hm.group(1))
            count = int(hm.group(2)) if hm.group(2) is not None else 1
            if count > 0:
                ranges[cur].append([start, start + count - 1])
    return ranges


def to_class(path: str):
    n = path.replace("\\", "/")
    for prefix in ("src/main/java/", "src/test/java/"):
        if n.startswith(prefix):
            return n[len(prefix):].replace("/", ".").replace(".java", "")
    return None


# ── helpers ────────────────────────────────────────────────────────────────────

def _attr(tag: str, name: str) -> str:
    m = re.search(rf'\b{name}="([^"]*)"', tag, re.IGNORECASE)
    return m.group(1) if m else "?"


def _find_ranges(abs_path: str, changed_ranges: dict):
    norm = abs_path.replace("\\", "/").lower()
    for git_path, ranges in changed_ranges.items():
        gn = git_path.lower()
        if norm == gn or norm.endswith("/" + gn):
            return ranges
    return None


def _in_range(line_str: str, ranges) -> bool:
    if not ranges:
        return False
    try:
        n = int(line_str)
    except (ValueError, TypeError):
        return False
    return any(s <= n <= e for s, e in ranges)


def mvn_silent(cmd: str):
    subprocess.run(cmd, shell=True, capture_output=True)


def clean(p: str):
    try:
        os.remove(p)
    except FileNotFoundError:
        pass


# ── XML parsers (chunk-filtered, mirrors quality.js) ──────────────────────────

def parse_checkstyle_xml(changed_ranges: dict):
    xml_path = "target/checkstyle-result.xml"
    if not os.path.exists(xml_path):
        return None
    xml = Path(xml_path).read_text(encoding="utf-8")
    viols = []
    for fm in re.finditer(r'<file name="([^"]*)">([\s\S]*?)</file>', xml):
        ranges = _find_ranges(fm.group(1), changed_ranges)
        if ranges is None:
            continue
        fname = os.path.basename(fm.group(1))
        for em in re.finditer(r'<error\b([^/]*)\s*/>', fm.group(2)):
            line = _attr(em.group(1), "line")
            if not _in_range(line, ranges):
                continue
            msg = _attr(em.group(1), "message")
            viols.append(f"  [Checkstyle] {fname}:{line} — {msg}")
    return viols


def parse_pmd_xml(changed_ranges: dict):
    xml_path = "target/pmd.xml"
    if not os.path.exists(xml_path):
        return None
    xml = Path(xml_path).read_text(encoding="utf-8")
    viols = []
    for fm in re.finditer(r'<file name="([^"]*)">([\s\S]*?)</file>', xml):
        ranges = _find_ranges(fm.group(1), changed_ranges)
        if ranges is None:
            continue
        fname = os.path.basename(fm.group(1))
        for vm in re.finditer(r'<violation\b([^>]*)>([\s\S]*?)</violation>', fm.group(2)):
            line = _attr(vm.group(1), "beginline")
            if not _in_range(line, ranges):
                continue
            rule = _attr(vm.group(1), "rule")
            msg  = vm.group(2).strip()
            viols.append(f"  [PMD:{rule}] {fname}:{line} — {msg}")
    return viols


def parse_spotbugs_xml(changed_ranges: dict):
    for candidate in ("target/spotbugsXml.xml", "target/spotbugs.xml"):
        if os.path.exists(candidate):
            xml_path = candidate
            break
    else:
        return None
    xml = Path(xml_path).read_text(encoding="utf-8")
    viols = []
    for bm in re.finditer(r'<BugInstance\b([^>]*)>([\s\S]*?)</BugInstance>', xml):
        bug_type = _attr(bm.group(1), "type")
        body     = bm.group(2)
        src_m    = re.search(r'sourcefile="([^"]*\.java)"', body)
        if not src_m:
            continue
        src_file = src_m.group(1)
        entry = next(
            ((gp, rng) for gp, rng in changed_ranges.items()
             if gp.lower().endswith("/" + src_file.lower()) or gp.lower() == src_file.lower()),
            None
        )
        if not entry:
            continue
        line_m = re.search(r'start="(\d+)"', body)
        line   = line_m.group(1) if line_m else "?"
        if not _in_range(line, entry[1]):
            continue
        msg_m = re.search(r'<LongMessage>([\s\S]*?)</LongMessage>', body)
        msg   = msg_m.group(1).strip() if msg_m else bug_type
        viols.append(f"  [SpotBugs:{bug_type}] {src_file}:{line} — {msg}")
    return viols


# ── main MCP tool ──────────────────────────────────────────────────────────────

def code_fixer() -> str:

    staged = get_staged_java_files()
    if not staged:
        return "No staged Java files found. Run `git add <files>` first."

    changed_ranges = get_changed_line_ranges()
    classes = ",".join(filter(None, (to_class(f) for f in staged)))

    # Deploy configs into target/ so Maven resolves by relative path
    os.makedirs("target", exist_ok=True)
    shutil.copy(str(_PKG_ROOT / "config" / "checkstyle.xml"), "target/sq-checkstyle.xml")
    shutil.copy(str(_PKG_ROOT / "config" / "pmd-rules.xml"),  "target/sq-pmd-rules.xml")

    # Run tools silently — violations read from XML
    clean("target/checkstyle-result.xml")
    mvn_silent('mvn checkstyle:checkstyle -Dcheckstyle.config.location="target/sq-checkstyle.xml"')

    clean("target/pmd.xml")
    mvn_silent('mvn pmd:pmd -Dpmd.rulesets="target/sq-pmd-rules.xml"')

    mvn_silent("mvn compile -q")
    clean("target/spotbugsXml.xml")
    sb_cmd = (
        f'mvn spotbugs:spotbugs -Dspotbugs.onlyAnalyze="{classes}" -Dspotbugs.xmlOutput=true'
        if classes else "mvn spotbugs:spotbugs -Dspotbugs.xmlOutput=true"
    )
    mvn_silent(sb_cmd)

    # Parse — only violations inside changed chunks
    cs_viols  = parse_checkstyle_xml(changed_ranges) or []
    pmd_viols = parse_pmd_xml(changed_ranges) or []
    sb_viols  = parse_spotbugs_xml(changed_ranges) or []
    all_viols = cs_viols + pmd_viols + sb_viols

    if not all_viols:
        return "No quality violations in your changed lines — nothing to fix."

    # Read only the changed chunks from each staged file
    chunks_text = ""
    for f in staged:
        if not os.path.exists(f):
            continue
        git_path = f.replace("\\", "/")
        file_ranges = changed_ranges.get(git_path) or next(
            (rng for gp, rng in changed_ranges.items()
             if gp.lower().endswith("/" + git_path.lower().split("/")[-1])),
            None
        )
        lines = Path(f).read_text(encoding="utf-8").splitlines()
        chunks = []
        if file_ranges:
            for start, end in file_ranges:
                chunk_lines = lines[start - 1 : end]  # 1-indexed → 0-indexed
                chunks.append(f"Lines {start}–{end}:\n" + "\n".join(chunk_lines))
        chunks_text += f"\n### {f}\n" + "\n\n".join(chunks) + "\n"

    violations_text = "\n".join(all_viols)

    return f"""You are a Senior Spring Boot Engineer. Fix ONLY the violations listed below.
They are all within the changed chunks of the current commit — do not touch any other lines.

## Changed Chunks
{chunks_text}

## Violations in Changed Lines
{violations_text}

## Instructions
1. Fix every Checkstyle violation (line length, naming, empty catch blocks)
2. Fix every PMD violation (unused variables, complexity)
3. Fix every SpotBugs violation (encoding, null dereference, resource leaks)
4. Change ONLY the lines reported above — do not refactor or reformat anything else
5. Return the corrected chunks showing the fixed lines with their line numbers
"""
