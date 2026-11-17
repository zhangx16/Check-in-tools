class MemoryCache {
  constructor({ ttlMs = 30000, maxEntries = 32, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }
  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return;
    if (hit.exp <= this.now()) {
      this.entries.delete(key);
      return;
    }
    return structuredClone(hit.value);
  }
  set(key, value) {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries)
      this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, {
      value: structuredClone(value),
      exp: this.now() + this.ttlMs,
    });
    return value;
  }
  clear() {
    this.entries.clear();
  }
}
module.exports = { MemoryCache };
