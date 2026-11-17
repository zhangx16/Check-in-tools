const fs = require("fs"),
  path = require("path"),
  { spawnSync } = require("child_process");
const files = fs
  .readdirSync("tests")
  .filter((x) => x.endsWith(".js"))
  .map((x) => path.join("tests", x));
const node = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
if (node.status !== 0) process.exit(node.status || 1);
const python = path.resolve(".venv-embykeeper/bin/python");
if (fs.existsSync(python)) {
  const result = spawnSync(
    python,
    ["-m", "unittest", "discover", "-s", "tests", "-p", "test_telegram*.py"],
    { stdio: "inherit", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  if (result.status !== 0) process.exit(result.status || 1);
} else console.log("Telegram Python tests skipped: optional venv is absent");
