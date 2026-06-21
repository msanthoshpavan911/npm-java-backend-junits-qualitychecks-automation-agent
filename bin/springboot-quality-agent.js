#!/usr/bin/env node

const { Command } = require("commander");

const init     = require("../commands/init");
const scan     = require("../commands/scan");
const quality  = require("../commands/quality");
const coverage = require("../commands/coverage");
const hooks    = require("../commands/hooks");

const program = new Command();

program
    .name("springbootquality-check911")
    .description(
`Spring Boot Quality Agent — scan, fix, and enforce code quality on your Java project.

MANUAL USAGE (run anytime before committing):
  $ springbootquality-check911 quality    — scan staged files for Checkstyle / PMD / SpotBugs violations
  $ springbootquality-check911 coverage   — check JaCoCo coverage for staged/changed files only

SETUP COMMANDS:
  $ springbootquality-check911 init       — configure which quality checks to enable for this project
  $ springbootquality-check911 scan       — index all Java files (used by MCP / Copilot)
  $ springbootquality-check911 hooks      — install git pre-commit hook (auto-runs quality + coverage on commit)`)
    .version("1.0.18");

program
    .command("init")
    .description("Configure quality checks for this project (saves .quality-agent.json)")
    .action(init);

program
    .command("scan")
    .description("Index all Java files in the repository for MCP/Copilot context")
    .action(scan);

program
    .command("quality")
    .description("Scan staged Java files for Checkstyle, PMD and SpotBugs violations — run manually or via pre-commit hook")
    .action(quality);

program
    .command("coverage")
    .description("Check JaCoCo line coverage for staged/changed Java files only — run manually or via pre-commit hook")
    .action(coverage);

program
    .command("hooks")
    .description("Install git pre-commit hook that auto-runs quality + coverage checks on every commit")
    .action(hooks);

program.addHelpText("after", `
Examples:
  # First-time setup
  springbootquality-check911 init
  springbootquality-check911 hooks

  # Before committing — manually check your staged changes
  git add src/main/java/com/example/OrderService.java
  springbootquality-check911 quality     # see violations before they block your commit
  springbootquality-check911 coverage    # see coverage gaps before they block your commit
`);

program.parse(process.argv);
