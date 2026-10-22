const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDataDir, formatDateTime } = require("./common");

const TELEGRAM_CHAT_ID_FILE = path.join(DATA_DIR, "telegram-chat-id.txt");

function getTelegramConfig() {
  return {
    botToken: String(process.env.TELEGRAM_BOT_TOKEN || "").trim(),
    chatId: String(process.env.TELEGRAM_CHAT_ID || "").trim(),
    dryRun: ["1", "true", "yes", "on"].includes(
      String(process.env.TELEGRAM_DRY_RUN || "").trim().toLowerCase()
    ),
    timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000)
  };
}

function readStoredTelegramChatId() {
  try {
    return fs.readFileSync(TELEGRAM_CHAT_ID_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function storeTelegramChatId(chatId) {
  if (!chatId) return;
  ensureDataDir();
  fs.writeFileSync(TELEGRAM_CHAT_ID_FILE, `${chatId}\n`);
}

async function telegramApi(method, payload = null) {
  const { botToken, timeoutMs } = getTelegramConfig();
  if (!botToken) {
    throw new Error("未配置 TELEGRAM_BOT_TOKEN");
  }

  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const options = {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : {},
    signal: AbortSignal.timeout(timeoutMs)
  };

  if (payload) {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Telegram 返回异常: ${text.slice(0, 180)}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API 失败: ${data.description || text.slice(0, 180)}`);
  }

  return data.result;
}

async function telegramBotApiByToken(botToken, method, params = {}) {
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured");
  }
  const url = new URL(`https://api.telegram.org/bot${botToken}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 15000));
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    if (!payload?.ok) {
      throw new Error(payload?.description || `Telegram API ${method} failed`);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTelegramChatId() {
  const { chatId } = getTelegramConfig();
  if (chatId) return chatId;

  const stored = readStoredTelegramChatId();
  if (stored) return stored;

  const updates = await telegramApi("getUpdates");
  const latest = [...updates]
    .reverse()
    .map((item) => item.message || item.edited_message || item.channel_post || item.callback_query?.message || null)
    .find((message) => message?.chat?.id != null);

  const resolved = latest?.chat?.id != null ? String(latest.chat.id) : "";
  if (resolved) {
    storeTelegramChatId(resolved);
  }
  return resolved;
}

function splitTelegramText(text, limit = 3500) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let index = remaining.lastIndexOf("\n", limit);
    if (index < 0 || index < limit / 2) {
      index = limit;
    }
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).replace(/^\n+/, "");
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendTelegramReport(text) {
  const { dryRun } = getTelegramConfig();
  if (dryRun) {
    console.log("[telegram dry run]");
    console.log(text);
    return "dry-run";
  }

  const resolvedChatId = await resolveTelegramChatId();
  if (!resolvedChatId) {
    throw new Error("无法确定 Telegram chat_id。请先给机器人发送一条消息，或在 .env 中设置 TELEGRAM_CHAT_ID。");
  }

  for (const chunk of splitTelegramText(text)) {
    await telegramApi("sendMessage", {
      chat_id: resolvedChatId,
      text: chunk,
      disable_web_page_preview: true
    });
  }

  return resolvedChatId;
}

module.exports = {
  getTelegramConfig,
  telegramApi,
  telegramBotApiByToken,
  resolveTelegramChatId,
  splitTelegramText,
  sendTelegramReport,
  readStoredTelegramChatId,
  storeTelegramChatId
};
