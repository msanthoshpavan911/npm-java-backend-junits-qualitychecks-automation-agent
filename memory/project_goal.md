---
name: project-goal-npm-copilot-agent
description: springboot-quality-agent — npm package that auto-configures GitHub Copilot + MCP for Spring Boot repos
metadata:
  type: project
---

This project is an npm package (`springboot-quality-agent`) that developers install in any Spring Boot repo.

**Goal:** After `npm install` + `springboot-quality-agent init`, GitHub Copilot (integrated in VS Code) automatically handles generating tests, fixing code smells/linting, and validating JaCoCo coverage whenever the developer commits or pushes — with zero extra tooling setup.

**Flow:**
1. `npm install -g springboot-quality-agent` (or as dev dep)
2. `springboot-quality-agent init` → sets up git hooks, Copilot instructions, MCP server config
3. `git commit` → pre-commit hook runs Checkstyle/PMD/SpotBugs; if fail, guides user to Copilot Chat to fix in one go
4. `git push` → pre-push hook verifies JaCoCo ≥95%; if fail, guides user to Copilot to generate missing tests

**Why:** User wants zero-friction quality gates powered by integrated Copilot — no separate MCP server management, no manual steps beyond install + init.

**How to apply:** All design decisions must keep the end-user experience to: install → init → commit/push. No Python knowledge required from end users. MCP server setup is automated by the package's postinstall + init scripts.
