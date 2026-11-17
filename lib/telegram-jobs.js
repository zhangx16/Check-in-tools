const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { atomicWrite } = require("./store/json-store");
function createTelegramJobs({ dataDir, run }) {
  const file = path.join(dataDir, "embykeeper/job.json");
  let active = null;
  function get() {
    if (!fs.existsSync(file)) return { state: "idle" };
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (["queued", "running"].includes(saved.state) && !active)
      return {
        ...saved,
        state: "interrupted",
        message: "服务已重启，请重新执行签到",
      };
    return saved;
  }
  function launch() {
    if (active) return { ...active };
    const job = {
      id: crypto.randomUUID(),
      state: "queued",
      startedAt: new Date().toISOString(),
      message: "Telegram 签到已进入后台",
    };
    active = job;
    atomicWrite(file, job);
    setImmediate(async () => {
      try {
        job.state = "running";
        atomicWrite(file, job);
        const result = await run();
        Object.assign(job, {
          state: result.ok ? "completed" : "failed",
          ok: result.ok,
          message: result.ok
            ? "Telegram 签到执行完成"
            : result.error || "Telegram 签到执行失败",
        });
      } catch {
        Object.assign(job, {
          state: "failed",
          ok: false,
          message: "Telegram 后台任务执行失败",
        });
      } finally {
        job.finishedAt = new Date().toISOString();
        try {
          atomicWrite(file, job);
        } catch {
          require("./log").log("error", "telegram.job.persist_failed");
        } finally {
          active = null;
        }
      }
    });
    return { ...job };
  }
  return { launch, get };
}
module.exports = { createTelegramJobs };
