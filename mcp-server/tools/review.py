import json

from tools.impact_analyzer import impact_analyzer
from tools.quality_scanner import quality_scanner
from tools.coverage_checker import coverage_checker
from tools.prompt_generator import prompt_generator

def review():

    return json.dumps({

        "impact": impact_analyzer(),
        "quality": quality_scanner(),
        "coverage": coverage_checker(),
        "prompt": prompt_generator()

    }, indent=2)
