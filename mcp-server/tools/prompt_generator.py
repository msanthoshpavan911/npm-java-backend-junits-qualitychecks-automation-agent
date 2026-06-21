import os
import subprocess

def get_changed_files():

    result = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only"],
        text=True
    )

    return result


def read_file_contents(paths):

    contents = ""

    for p in paths:
        p = p.strip()
        if p and p.endswith(".java") and os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                contents += f"\n### {p}\n```java\n{f.read()}\n```\n"

    return contents


def prompt_generator():

    changed_raw = get_changed_files()
    changed_files = [f for f in changed_raw.splitlines() if f.strip()]
    file_contents = read_file_contents(changed_files)

    return f"""
You are a Senior Spring Boot Architect.

Changed Files:

{changed_raw}

File Contents:

{file_contents}

Tasks:

1. Analyze impacted classes.
2. Generate JUnit5 tests for every public method.
3. Generate Mockito tests — mock all dependencies.
4. Coverage target: 95% line coverage.

Fix PMD violations.
Fix SpotBugs violations.
Fix Checkstyle violations.
"""
