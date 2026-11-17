#!/usr/bin/env node
const fs = require("fs"),
  path = require("path"),
  { spawn } = require("child_process");
const { loadLocalEnv, DATA_DIR } = require("../lib/common");
loadLocalEnv();
const { PROVIDER_FILES } = require("../lib/accounts");
const { acquireLock } = require("../lib/store/file-lock");
const ROOT = path.resolve(__dirname, "..");
const scripts = {
  glados: "daily_checkin_report.js",
  embypulse: "embypulse_daily_checkin.js",
  embymb: "embymb_daily_checkin.js",
  vpsnat: "vpsnat_daily_checkin.js",
  thxnk: "thxnk_daily_checkin.js",
  zzcat: "zzcat_daily_checkin.js",
  workbuddy: "workbuddy_daily_checkin.js",
};
function read(file, fallback) {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : fallback;
}
function plan() {
  const selected = String(process.env.RUNNER_PROVIDERS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const allowed = (name) => !selected.length || selected.includes(name);
  if (
    selected.some(
      (name) =>
        ![...Object.keys(scripts), "telegram", "emby_keepalive"].includes(name),
    )
  )
    throw Error("Unknown runner provider");
  const tasks = [];
  for (const [provider, script] of Object.entries(scripts)) {
    const accounts = read(PROVIDER_FILES[provider], []);
    if (!Array.isArray(accounts)) throw Error("Invalid account file");
    if (allowed(provider) && accounts.some((a) => a.enabled !== false))
      tasks.push({
        provider,
        command: process.execPath,
        args: [path.join(ROOT, "scripts", script)],
      });
  }
  const form = read(path.join(DATA_DIR, "embykeeper/form.json"), {});
  if (
    allowed("telegram") &&
    form.botTemplates?.length &&
    form.telegramAccounts?.some(
      (a) => a.enabled !== false && a.checkiner !== false,
    )
  )
    tasks.push({
      provider: "telegram",
      command: path.join(ROOT, ".venv-embykeeper/bin/python"),
      args: [path.join(ROOT, "scripts/telegram_bot_checkin.py")],
    });
  if (
    allowed("emby_keepalive") &&
    read(path.join(DATA_DIR, "emby_keepalive_accounts.json"), []).some(
      (a) => a.enabled !== false,
    )
  )
    tasks.push({
      provider: "emby_keepalive",
      command: process.execPath,
      args: [path.join(ROOT, "scripts/emby_keepalive.js")],
    });
  return tasks;
}
function execute(task) {
  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    let timedOut = false;
    const timeout =
      task.provider === "telegram"
        ? 600000
        : Number(process.env.RUNNER_TASK_TIMEOUT_MS || 3600000);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
      kill.unref();
    }, timeout);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(!timedOut && code === 0);
    });
  });
}
async function main(args = process.argv.slice(2)) {
  const dry = args.includes("--dry-run"),
    loop = args.includes("--loop");
  if (args.some((x) => !["--dry-run", "--loop"].includes(x)))
    throw Error("Unknown option");
  do {
    const tasks = plan();
    if (dry) {
      console.log(
        JSON.stringify(
          { dryRun: true, providers: tasks.map((x) => x.provider) },
          null,
          2,
        ),
      );
      return;
    }
    const release = acquireLock(path.join(DATA_DIR, "runner.lock"), {
      timeoutMs: 0,
    });
    let ok = true;
    try {
      for (const task of tasks) {
        console.log(
          JSON.stringify({
            level: "info",
            msg: "runner.start",
            provider: task.provider,
          }),
        );
        if (!(await execute(task))) ok = false;
      }
    } finally {
      release();
    }
    if (!loop) {
      if (!ok) process.exitCode = 1;
      return;
    }
    await new Promise((r) => setTimeout(r, 24 * 60 * 60 * 1000));
  } while (loop);
}
if (require.main === module)
  main().catch(() => {
    console.error("checkin runner failed; inspect provider logs");
    process.exitCode = 1;
  });
module.exports = { plan, execute, main };
