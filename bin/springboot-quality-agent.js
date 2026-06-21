#!/usr/bin/env node

const { Command } = require("commander");

const init = require("../commands/init");
const scan = require("../commands/scan");
const quality = require("../commands/quality");
const coverage = require("../commands/coverage");
const hooks = require("../commands/hooks");

const program = new Command();

program
  .name("springbootquality-check911")
  .description("Spring Boot Quality Agent")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize project")
  .action(init);

program
  .command("scan")
  .description("Scan repository")
  .action(scan);

program
  .command("quality")
  .description("Run quality checks")
  .action(quality);

program
  .command("coverage")
  .description("Verify coverage")
  .action(coverage);

program
  .command("hooks")
  .description("Generate git hooks")
  .action(hooks);

program.parse(process.argv);