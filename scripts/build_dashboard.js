#!/usr/bin/env node
// Publish only application assets. The offline snapshot stays in the design directory.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'design/checkin-dashboard');
const target = path.join(root, 'public/dashboard');
fs.mkdirSync(target, { recursive: true });
for (const name of ['dashboard-runtime.js', 'dashboard-patches.css', ...Array.from({length: 5}, (_, i) => `reference-${i}.css`)]) {
  fs.copyFileSync(path.join(source, name), path.join(target, name));
}
const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
  .replace('<script src="snapshot.js"></script>', '');
if (html.includes('CHECKIN_DRAFT') || html.includes('snapshot.js') || html.includes('draft-kit')) {
  throw new Error('Refusing to publish preview data or review tools');
}
fs.writeFileSync(path.join(target, 'index.html'), html);
console.log('Dashboard assets published to public/dashboard');
