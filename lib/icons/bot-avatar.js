const fs = require("fs"),
  path = require("path");
const { createIconCache } = require("./cache");
module.exports = function createIcons({
  BOT_AVATAR_DIR,
  BOT_AVATAR_TTL_MS,
  TELEGRAM_BOT_TOKEN,
  telegramBotApiByToken,
  REQUEST_TIMEOUT_MS,
}) {
  function ensureBotAvatarDir() {
    if (!fs.existsSync(BOT_AVATAR_DIR)) {
      fs.mkdirSync(BOT_AVATAR_DIR, { recursive: true });
    }
  }
  async function telegramBotApi(method, params = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN not configured");
    }
    return telegramBotApiByToken(TELEGRAM_BOT_TOKEN, method, params);
  }
  async function ensureBotAvatar(username) {
    const user = String(username || "")
      .trim()
      .replace(/^@/, "");
    if (!user || !TELEGRAM_BOT_TOKEN) {
      return null;
    }

    ensureBotAvatarDir();
    const safe = user.replace(/[^a-zA-Z0-9_]/g, "_");
    const filePath = path.join(BOT_AVATAR_DIR, `${safe}.jpg`);
    const metaPath = path.join(BOT_AVATAR_DIR, `${safe}.meta.json`);
    const publicPath = `/bot-avatars/${safe}.jpg`;

    try {
      if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (
          meta?.fetchedAt &&
          Date.now() - Number(meta.fetchedAt) < BOT_AVATAR_TTL_MS
        ) {
          return publicPath;
        }
      }
    } catch {
      // refresh below
    }

    try {
      const chat = await telegramBotApi("getChat", { chat_id: `@${user}` });
      const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id;
      if (!fileId) {
        return fs.existsSync(filePath) ? publicPath : null;
      }
      const file = await telegramBotApi("getFile", { file_id: fileId });
      const filePathRemote = file?.file_path;
      if (!filePathRemote) {
        return fs.existsSync(filePath) ? publicPath : null;
      }
      const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePathRemote}`;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.min(REQUEST_TIMEOUT_MS, 20000),
      );
      try {
        const response = await fetch(downloadUrl, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`download avatar HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        fs.writeFileSync(
          metaPath,
          JSON.stringify(
            {
              username: user,
              fetchedAt: Date.now(),
              title: chat?.title || chat?.first_name || user,
            },
            null,
            2,
          ),
        );
        return publicPath;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      // Keep stale cache if present.
      if (fs.existsSync(filePath)) {
        return publicPath;
      }
      return null;
    }
  }
  const cached = createIconCache(
    BOT_AVATAR_DIR,
    "bot-avatars",
    ensureBotAvatar,
    BOT_AVATAR_TTL_MS,
  );
  return { ensureBotAvatar, getBotAvatar: cached };
};
