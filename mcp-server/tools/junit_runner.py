import os
import subprocess
import xml.etree.ElementTree as ET


def _maven_cmd():
    if os.path.exists("mvnw.cmd"):
        return ["mvnw.cmd"]
    if os.path.exists("mvnw"):
        return ["./mvnw"]
    return ["mvn"]


def run_tests_for_class(class_name: str) -> dict:
    """
    Runs Maven tests for one class, generates JaCoCo report, returns line coverage %.
    Accepts either the source class name (UserServiceImpl) or test class name (UserServiceImplTest).
    """
    test_class = class_name if class_name.endswith("Test") else class_name + "Test"
    src_class  = class_name[:-4] if class_name.endswith("Test") else class_name

    cmd = _maven_cmd() + [
        "test", f"-Dtest={test_class}", "jacoco:report",
        "--no-transfer-progress", "-q"
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    passed = proc.returncode == 0

    # Parse JaCoCo XML for the source class line coverage
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
    failures = [
        l.strip() for l in output.splitlines()
        if any(kw in l for kw in ("ERROR", "FAIL", "Tests run", "BUILD FAILURE"))
    ]

    return {
        "passed":       passed,
        "test_class":   test_class,
        "src_class":    src_class,
        "coverage_pct": coverage_pct,
        "failures":     failures[:8] if not passed else [],
        "build_tail":   output[-800:] if not passed else "",
    }
