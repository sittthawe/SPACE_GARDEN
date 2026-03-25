#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const GALLERY_PATHS = ["data/album.json", "uploads"];
const GIT_COMMAND = resolveGitCommand();

function resolveGitCommand() {
  if (process.platform !== "win32") {
    return "git";
  }

  const candidates = [
    process.env.GIT_EXE,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Git\\cmd\\git.exe`,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Git\\bin\\git.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Git\\cmd\\git.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Git\\bin\\git.exe`,
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "git";
}

function printHelp() {
  console.log(`Usage: node scripts/publish-gallery.js [options]

Options:
  --message, -m <text>  Commit message to use
  --push, -p            Push the commit to origin/<current-branch>
  --dry-run             Show pending gallery changes without committing
  --help, -h            Show this help message
`);
}

function runGit(args, options = {}) {
  const { captureOutput = true, allowFailure = false } = options;
  const result = spawnSync(GIT_COMMAND, args, {
    stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    const command = `git ${args.join(" ")}`;
    const stderr = (result.stderr || "").trim();
    console.error(stderr || `${command} failed.`);
    process.exit(result.status || 1);
  }

  return result;
}

function parseArgs(argv) {
  let push = false;
  let dryRun = false;
  let message = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--push" || arg === "-p") {
      push = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--message" || arg === "-m") {
      message = argv[index + 1] || "";
      index += 1;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return { push, dryRun, message };
}

function getCurrentBranch() {
  const result = runGit(["branch", "--show-current"]);
  return (result.stdout || "").trim();
}

function getGalleryStatus(args = ["status", "--short", "--", ...GALLERY_PATHS]) {
  return (runGit(args).stdout || "").trim();
}

function ensureNoUnrelatedStagedChanges() {
  const staged = (runGit(["diff", "--cached", "--name-only"]).stdout || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const unrelated = staged.filter((entry) => entry !== "data/album.json" && !entry.startsWith("uploads/"));

  if (unrelated.length === 0) {
    return;
  }

  console.error("Refusing to publish gallery changes because other staged files are present:");
  for (const file of unrelated) {
    console.error(`- ${file}`);
  }
  console.error("Commit or unstage those files first, then rerun this command.");
  process.exit(1);
}

function buildDefaultMessage() {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  return `Publish gallery updates (${stamp} UTC)`;
}

function main() {
  const { push, dryRun, message } = parseArgs(process.argv.slice(2));
  const beforeStatus = getGalleryStatus();

  if (!beforeStatus) {
    console.log("No gallery changes to publish.");
    return;
  }

  if (dryRun) {
    console.log(beforeStatus);
    return;
  }

  ensureNoUnrelatedStagedChanges();
  runGit(["add", "-A", "--", ...GALLERY_PATHS], { captureOutput: false });

  const stagedGallery = getGalleryStatus(["diff", "--cached", "--name-status", "--", ...GALLERY_PATHS]);
  if (!stagedGallery) {
    console.log("Gallery paths are already published.");
    return;
  }

  const commitMessage = message || buildDefaultMessage();
  runGit(["commit", "-m", commitMessage, "--", ...GALLERY_PATHS], { captureOutput: false });

  if (!push) {
    console.log("Gallery changes committed locally. Rerun with --push to send them to GitHub.");
    return;
  }

  const branch = getCurrentBranch();
  if (!branch) {
    console.error("Could not determine the current git branch.");
    process.exit(1);
  }

  runGit(["push", "origin", branch], { captureOutput: false });
  console.log(`Gallery changes pushed to origin/${branch}.`);
}

main();
