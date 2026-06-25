import os

from fastmcp import FastMCP
from tools.impact_analyzer import impact_analyzer
from tools.quality_scanner import quality_scanner
from tools.repository_indexer import repository_indexer
from tools.coverage_checker import coverage_checker
from tools.review import review
from tools.prompt_generator import prompt_generator
from tools.code_fixer import code_fixer

mcp = FastMCP("SpringBoot Architect")

@mcp.tool()
def ping():
    return "MCP Working"

@mcp.tool()
def impact():
    """
    Analyze git changes and identify impacted files.
    """
    return impact_analyzer()

@mcp.tool()
def quality():
    """Run Checkstyle, PMD and SpotBugs — returns actual violation messages."""
    return quality_scanner()

@mcp.tool()
def index():
    """
    Generate repository index — use this first to find which files exist
    before reading them, so you never scan the whole repo unnecessarily.
    """
    return repository_indexer()

@mcp.tool()
def coverage():
    """Check JaCoCo line coverage against the 95% threshold."""
    try:
        return coverage_checker()
    except Exception as ex:
        return f"Coverage Tool Failed: {str(ex)}"

@mcp.tool()
def prompt():
    """
    Generate Copilot prompt for impacted files — includes file contents.
    """
    return prompt_generator()

@mcp.tool()
def review_project():
    """
    Run repository review including impact analysis,
    quality checks and coverage validation.
    """
    return review()

@mcp.tool()
def fix():
    """
    Get everything needed to fix staged files in one pass:
    file contents + Checkstyle/PMD/SpotBugs violations + test generation tasks.
    Call this when the user asks to fix quality issues or generate tests.
    """
    return code_fixer()

@mcp.tool()
def read_file(path: str) -> str:
    """
    Read a specific source file by path.
    Use index() first to find the path, then call this — avoids scanning the whole repo.
    """
    if not os.path.exists(path):
        return f"File not found: {path}"
    with open(path, encoding="utf-8") as f:
        return f.read()

@mcp.tool()
def write_file(path: str, content: str) -> str:
    """
    Write (create or overwrite) a file with the given content.
    Used by the JUnit Coverage Expert agent to write test files during iteration.
    Creates parent directories automatically.
    """
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Written: {path}"
    except Exception as e:
        return f"Error writing {path}: {str(e)}"

@mcp.tool()
def run_tests_for(class_name: str) -> str:
    """
    Run JUnit tests for a specific class, generate JaCoCo report, and return line coverage %.
    Pass the source class name (e.g. 'UserServiceImpl') or the test class name ('UserServiceImplTest').
    Used by the JUnit Coverage Expert agent after each write to decide whether to iterate.
    """
    from tools.junit_runner import run_tests_for_class
    r = run_tests_for_class(class_name)

    lines = [
        f"Test class : {r['test_class']}",
        f"Status     : {'PASSED' if r['passed'] else 'FAILED'}",
        f"Coverage   : {r['coverage_pct']}%" if r['coverage_pct'] is not None
                     else "Coverage   : N/A (run 'mvn test jacoco:report' first)",
    ]
    if r.get("failures"):
        lines.append("\nTest failures:")
        lines.extend(f"  {f}" for f in r["failures"])
    if not r["passed"] and r.get("build_tail"):
        lines.append(f"\nBuild output (tail):\n{r['build_tail'][-600:]}")

    return "\n".join(lines)

if __name__ == "__main__":
    mcp.run()
