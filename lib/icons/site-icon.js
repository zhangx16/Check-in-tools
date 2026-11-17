const fs = require("fs"),
  path = require("path");
const { createIconCache } = require("./cache");
module.exports = function createIcons({
  SITE_ICON_DIR,
  USER_AGENT,
  SITE_ICON_TTL_MS,
  PROVIDER_DEFAULT_BASE,
  DEFAULT_GLADOS_BASE_URL,
  normalizeBaseUrl,
}) {
  function ensureSiteIconDir() {
    if (!fs.existsSync(SITE_ICON_DIR)) {
      fs.mkdirSync(SITE_ICON_DIR, { recursive: true });
    }
  }
  function detectImageExt(buf, contentType = "") {
    if (buf && buf.length >= 8) {
      if (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47
      )
        return "png";
      if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
      if (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[8] === 0x57
      )
        return "webp";
      if (
        buf[0] === 0x00 &&
        buf[1] === 0x00 &&
        buf[2] === 0x01 &&
        buf[3] === 0x00
      )
        return "ico";
    }
    const ct = String(contentType || "").toLowerCase();
    if (ct.includes("png")) return "png";
    if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
    if (ct.includes("gif")) return "gif";
    if (ct.includes("webp")) return "webp";
    if (ct.includes("icon")) return "ico";
    return "bin";
  }
  function isProbablyHtml(buf) {
    if (!buf || buf.length < 12) return false;
    const head = buf.slice(0, 64).toString("utf8").toLowerCase();
    return (
      head.includes("<!doctype") ||
      head.includes("<html") ||
      head.includes("<head")
    );
  }
  async function fetchBinary(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });
      if (!response.ok) return null;
      const buf = Buffer.from(await response.arrayBuffer());
      const ct = response.headers.get("content-type") || "";
      if (isProbablyHtml(buf) || ct.includes("text/html")) return null;
      if (buf.length < 64) return null;
      return { buf, contentType: ct };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function discoverIconUrlsFromHtml(origin) {
    const urls = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      let html = "";
      try {
        const response = await fetch(`${origin}/`, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        });
        if (!response.ok) return urls;
        html = await response.text();
      } finally {
        clearTimeout(timer);
      }
      const hrefs = [];
      const re = /<link\b[^>]*>/gi;
      let m;
      while ((m = re.exec(html))) {
        const tag = m[0];
        if (
          !/rel\s*=\s*["'][^"']*icon/i.test(tag) &&
          !/rel\s*=\s*["']apple-touch-icon/i.test(tag)
        ) {
          continue;
        }
        const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch?.[1]) hrefs.push(hrefMatch[1]);
      }
      const og =
        html.match(
          /property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i,
        ) ||
        html.match(
          /content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i,
        );
      if (og?.[1]) hrefs.push(og[1]);

      for (const href of hrefs) {
        try {
          urls.push(new URL(href, `${origin}/`).toString());
        } catch {
          // ignore bad href
        }
      }
    } catch {
      // ignore
    }
    return urls;
  }
  async function ensureSiteIcon(provider, siteBaseUrl) {
    const key =
      String(provider || "site")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_") || "site";
    ensureSiteIconDir();

    // Fresh cache?
    try {
      const existing = fs
        .readdirSync(SITE_ICON_DIR)
        .filter(
          (name) => name.startsWith(`${key}.`) && !name.endsWith(".meta.json"),
        );
      for (const name of existing) {
        const filePath = path.join(SITE_ICON_DIR, name);
        const metaPath = path.join(SITE_ICON_DIR, `${key}.meta.json`);
        if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          if (
            meta?.fetchedAt &&
            Date.now() - Number(meta.fetchedAt) < SITE_ICON_TTL_MS
          ) {
            return `/site-icons/${name}`;
          }
        } else if (fs.existsSync(filePath)) {
          // stale without meta still usable as fallback
          return `/site-icons/${name}`;
        }
      }
    } catch {
      // refresh below
    }

    const fallbackBase = PROVIDER_DEFAULT_BASE[key] || DEFAULT_GLADOS_BASE_URL;
    let origin;
    try {
      origin = normalizeBaseUrl(siteBaseUrl || fallbackBase, fallbackBase);
    } catch {
      origin = fallbackBase;
    }
    let host = "";
    try {
      host = new URL(origin).hostname;
    } catch {
      host = "";
    }

    // Prefer PNG/JPEG sources first (iOS AsyncImage handles these best).
    const candidates = [
      `${origin}/favicon.png`,
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `${origin}/brand/logo.png`,
      `${origin}/logo.png`,
      `${origin}/static/favicon.png`,
      `${origin}/assets/favicon.png`,
    ];
    if (host) {
      candidates.push(
        `https://icon.horse/icon/${host}`,
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
        `https://icons.duckduckgo.com/ip3/${host}.ico`,
      );
    }
    candidates.push(
      `${origin}/static/favicon.ico`,
      `${origin}/assets/favicon.ico`,
      `${origin}/favicon.ico`,
    );

    // HTML-discovered icons first (higher quality logo/png often).
    const fromHtml = await discoverIconUrlsFromHtml(origin);
    const all = [...fromHtml, ...candidates];

    let icoFallback = null;
    for (const url of all) {
      const got = await fetchBinary(url);
      if (!got) continue;
      // Skip tiny placeholder images (e.g. 1x1).
      if (got.buf.length < 200) continue;
      let ext = detectImageExt(got.buf, got.contentType);
      if (ext === "bin") continue;
      // Prefer non-ICO for mobile; remember ICO as last resort.
      if (ext === "ico") {
        if (!icoFallback) icoFallback = { got, url };
        continue;
      }
      const fileName = `${key}.${ext === "jpeg" ? "jpg" : ext}`;
      const filePath = path.join(SITE_ICON_DIR, fileName);
      try {
        for (const name of fs.readdirSync(SITE_ICON_DIR)) {
          if (name.startsWith(`${key}.`) && !name.endsWith(".meta.json")) {
            fs.unlinkSync(path.join(SITE_ICON_DIR, name));
          }
        }
      } catch {
        // ignore
      }
      fs.writeFileSync(filePath, got.buf);
      fs.writeFileSync(
        path.join(SITE_ICON_DIR, `${key}.meta.json`),
        JSON.stringify(
          { provider: key, origin, source: url, fetchedAt: Date.now() },
          null,
          2,
        ),
      );
      return `/site-icons/${fileName}`;
    }

    if (icoFallback) {
      const fileName = `${key}.ico`;
      const filePath = path.join(SITE_ICON_DIR, fileName);
      try {
        for (const name of fs.readdirSync(SITE_ICON_DIR)) {
          if (name.startsWith(`${key}.`) && !name.endsWith(".meta.json")) {
            fs.unlinkSync(path.join(SITE_ICON_DIR, name));
          }
        }
      } catch {
        // ignore
      }
      fs.writeFileSync(filePath, icoFallback.got.buf);
      fs.writeFileSync(
        path.join(SITE_ICON_DIR, `${key}.meta.json`),
        JSON.stringify(
          {
            provider: key,
            origin,
            source: icoFallback.url,
            fetchedAt: Date.now(),
          },
          null,
          2,
        ),
      );
      return `/site-icons/${fileName}`;
    }
    return null;
  }
  const cached = createIconCache(
    SITE_ICON_DIR,
    "site-icons",
    ensureSiteIcon,
    SITE_ICON_TTL_MS,
  );
  return { ensureSiteIcon, getSiteIcon: cached };
};
