const fs = require("fs");
const { execSync } = require("child_process");

module.exports = function hooks() {

    fs.mkdirSync(".githooks", {
        recursive: true
    });

    fs.writeFileSync(
        ".githooks/pre-commit",
`#!/bin/bash

echo "Running Spring Boot quality checks..."
springbootquality-check911 quality

if [ $? -ne 0 ]; then
  echo ""
  echo "Fix with GitHub Copilot — open Copilot Chat and ask:"
  echo "  'Fix the quality violations in my staged files'"
  exit 1
fi
`
    );

    fs.writeFileSync(
        ".githooks/pre-push",
`#!/bin/bash

echo "Verifying test coverage..."
springbootquality-check911 coverage

if [ $? -ne 0 ]; then
  echo ""
  echo "Coverage below 95%. Fix with GitHub Copilot — open Copilot Chat and ask:"
  echo "  'Generate JUnit5 tests to reach 95% coverage for my changed files'"
  exit 1
fi
`
    );

    try {
        fs.chmodSync(".githooks/pre-commit", 0o755);
        fs.chmodSync(".githooks/pre-push", 0o755);
    } catch (_) {}

    execSync(
        "git config core.hooksPath .githooks"
    );

    console.log("Git hooks configured");
};
