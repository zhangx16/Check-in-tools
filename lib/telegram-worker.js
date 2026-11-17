module.exports = function createService(context) {
  const {
    PROJECT_ROOT,
    path,
    spawn,
    EMBYKEEPER_DIR,
    EMBYKEEPER_VENV_DIR,
    CUSTOM_TG_WORKER,
    readEmbykeeperForm,
    getEmbykeeperStatus,
  } = context;
  function runEmbykeeperOnce() {
    return new Promise((resolve) => {
      const status = getEmbykeeperStatus();
      if (!status.customWorkerExists) {
        resolve({
          ok: false,
          output: "",
          error: "Telegram 自定义签到 worker 不存在",
        });
        return;
      }
      if (!status.sessionStringCount) {
        resolve({
          ok: false,
          output: "",
          error: "缺少 Telegram 会话，请先执行首次登录",
        });
        return;
      }

      let release;
      try {
        release = require("./store/file-lock").acquireLock(
          path.join(EMBYKEEPER_DIR, "run.lock"),
          { timeoutMs: 0 },
        );
      } catch {
        resolve({ ok: false, output: "", error: "Telegram 签到任务正在运行" });
        return;
      }
      const child = spawn(
        path.join(EMBYKEEPER_VENV_DIR, "bin", "python"),
        [CUSTOM_TG_WORKER],
        {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let buffer = Buffer.alloc(0);
      const append = (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        if (buffer.length > 65536)
          buffer = buffer.subarray(buffer.length - 65536);
      };
      const output = () => buffer.toString("utf8");
      let settled = false;
      const timer = setTimeout(
        () => {
          if (settled) return;
          settled = true;
          child.kill("SIGTERM");
          const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
          killTimer.unref();
          resolve({
            ok: false,
            output: output(),
            error: "自定义 Telegram Bot 签到运行超时",
          });
        },
        Math.max(
          90000,
          Math.min(600000, readEmbykeeperForm().botTemplates.length * 45000),
        ),
      );

      child.stdout.on("data", (chunk) => {
        append(chunk);
      });
      child.stderr.on("data", (chunk) => {
        append(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          output: output(),
          error: "Telegram worker 无法启动",
        });
      });
      child.on("close", (code) => {
        release();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          output: output(),
          error: code === 0 ? "" : `emby-keeper exited with code ${code}`,
        });
      });
    });
  }

  return { runEmbykeeperOnce };
};
