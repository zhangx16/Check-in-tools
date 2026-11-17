#!/usr/bin/env node
// Publish only application assets. The offline snapshot stays in the design directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'design/checkin-dashboard');
const target = path.join(root, 'public/dashboard');
fs.mkdirSync(target, { recursive: true });
for (const name of ['dashboard-runtime.js', 'workbuddy-ui.js', 'emby-keepalive.js', 'dashboard-patches.css', ...Array.from({length: 5}, (_, i) => `reference-${i}.css`)]) {
  fs.copyFileSync(path.join(source, name), path.join(target, name));
}
let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
  .replace('<script src="snapshot.js"></script>', '');
// Give changed application assets a new URL so browser/CDN caches cannot serve an old UI.
for (const name of ['dashboard-runtime.js', 'workbuddy-ui.js', 'emby-keepalive.js', 'dashboard-patches.css']) {
  const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(target, name))).digest('hex').slice(0, 12);
  html = html.replace(new RegExp(name.replaceAll('.', '\\.') + '(?:\\?[^\"\\s>]*)?', 'g'), `${name}?v=${version}`);
}
if (html.includes('CHECKIN_DRAFT') || html.includes('snapshot.js') || html.includes('draft-kit')) {
  throw new Error('Refusing to publish preview data or review tools');
}
fs.writeFileSync(path.join(target, 'index.html'), html);
console.log('Dashboard assets published to public/dashboard');
