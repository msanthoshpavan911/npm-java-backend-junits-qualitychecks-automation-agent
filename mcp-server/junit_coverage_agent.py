import os
import subprocess
import xml.etree.ElementTree as ET

from fastmcp import FastMCP

INSTRUCTIONS = """
You are a JUnit 5 test generation expert for Spring Boot applications.
Your mission: generate tests for the provided Java class and keep improving them until line coverage reaches 95%+.

## Workflow

When the user provides a Java file (drag-and-drop or path):

### Step 1 — Read and analyse
Use read_file to read the source. Extract:
- Package, class name, class type (@Service / @RestController / @Repository / plain)
- All injected fields (private final XxxRepository repo; or @Autowired)
- All public methods with parameter types

### Step 2 — Generate the test file

**For @Service classes:**
```java
package <same-package>;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.util.Collections;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@ExtendWith(MockitoExtension.class)
class <ClassName>Test {

    @Mock private UserRepository userRepository;
    @InjectMocks private UserServiceImpl userService;

    @BeforeEach
    void setUp() {
        // CRITICAL: stub findById so orElseThrow() succeeds on the happy path
        lenient().when(userRepository.findById(any())).thenReturn(Optional.of(mock(User.class)));
        lenient().when(userRepository.findAll()).thenReturn(Collections.singletonList(mock(User.class)));
        lenient().when(userRepository.save(any())).thenReturn(mock(User.class));
        lenient().when(userRepository.existsById(any())).thenReturn(true);
        lenient().when(userRepository.count()).thenReturn(1L);
    }

    @Test
    void getUser_happyPath() {
        var result = userService.getUser(1L);
        assertNotNull(result);
    }

    @Test
    void getUser_whenNotFound_throwsException() {
        when(userRepository.findById(any())).thenReturn(Optional.empty());
        assertThrows(Exception.class, () -> userService.getUser(999L));
    }
}
```

**Argument type rules — NEVER pass null for these:**
| Type | Value |
|---|---|
| long / Long | 1L |
| int / Integer | 1 |
| String | "test" |
| boolean / Boolean | true |
| double / Double | 1.0 |
| Domain/DTO class (uppercase) | mock(ClassName.class) |
| List / Collection | Collections.emptyList() |
| Optional | Optional.empty() |

For each public method generate: happy-path test + not-found/exception test + null/boundary test.
For @RestController use @WebMvcTest + MockMvc. For @Repository use @DataJpaTest.

### Step 3 — Write the test file
Test path: src/main/java/com/example/service/UserServiceImpl.java → src/test/java/com/example/service/UserServiceImplTest.java
Use write_file to write the full file.

### Step 4 — Run tests and check coverage
Use run_tests_for with the source class name. It runs mvn test jacoco:report and returns line coverage %.

### Step 5 — Iterate if < 95% (up to 5 rounds)
1. Read back test file and source
2. Add targeted tests for uncovered branches (exception paths, null checks, else blocks, empty list inputs)
3. Write the FULL file (complete replacement every time)
4. Run run_tests_for again
5. Stop when coverage >= 95%

### Step 6 — Report
State: final coverage %, test file path, number of test methods, and any remaining uncovered lines.

## Rules
- NEVER use assertDoesNotThrow — it fails on any exception
- NEVER pass null for Long/String/domain object params
- ALWAYS use lenient() in @BeforeEach
- ALWAYS write the full test file on each iteration
"""

mcp = FastMCP("JUnit Coverage Expert", instructions=INSTRUCTIONS)


def _maven_cmd():
    if os.path.exists("mvnw.cmd"):
        return ["mvnw.cmd"]
    if os.path.exists("mvnw"):
        return ["./mvnw"]
    return ["mvn"]


@mcp.tool()
def read_file(path: str) -> str:
    """Read a Java source or test file by path."""
    if not os.path.exists(path):
        return f"File not found: {path}"
    with open(path, encoding="utf-8") as f:
        return f.read()


@mcp.tool()
def write_file(path: str, content: str) -> str:
    """
    Write (create or overwrite) a file with the given content.
    Creates parent directories automatically.
    Use this to write the generated test file on each iteration.
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
    Run JUnit tests for a class, generate JaCoCo report, and return line coverage %.
    Pass the source class name (e.g. UserServiceImpl) or test class name (UserServiceImplTest).
    Call this after every write_file to decide whether to iterate.
    """
    test_class = class_name if class_name.endswith("Test") else class_name + "Test"
    src_class  = class_name[:-4] if class_name.endswith("Test") else class_name

    cmd = _maven_cmd() + [
        "test", f"-Dtest={test_class}", "jacoco:report",
        "--no-transfer-progress", "-q"
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    passed = proc.returncode == 0

    coverage_pct = None
    xml_path = os.path.join("target", "site", "jacoco", "jacoco.xml")
    if os.path.exists(xml_path):
        try:
            root = ET.parse(xml_path).getroot()
            for cls in root.findall(".//class"):
                if cls.attrib.get("name", "").split("/")[-1] == src_class:
                    for ctr in cls.findall("counter"):
                        if ctr.attrib.get("type") == "LINE":
                            covered = int(ctr.attrib["covered"])
                            missed  = int(ctr.attrib["missed"])
                            total   = covered + missed
                            if total > 0:
                                coverage_pct = round(covered / total * 100, 1)
                    break
        except Exception:
            pass

    output   = (proc.stdout or "") + (proc.stderr or "")
    failures = [l.strip() for l in output.splitlines()
                if any(k in l for k in ("ERROR", "FAIL", "Tests run", "BUILD FAILURE"))]

    lines = [
        f"Test class : {test_class}",
        f"Status     : {'PASSED' if passed else 'FAILED'}",
        f"Coverage   : {coverage_pct}%" if coverage_pct is not None
                     else "Coverage   : N/A (run mvn test jacoco:report first)",
    ]
    if failures and not passed:
        lines.append("\nFailures:")
        lines.extend(f"  {f}" for f in failures[:8])
    if not passed and output:
        lines.append(f"\nBuild output (tail):\n{output[-600:]}")

    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
