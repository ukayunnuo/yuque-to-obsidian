import fs from 'node:fs';
import path from 'node:path';
const argCfg = (process.argv.find(a => a.startsWith('--config=')) || '').slice('--config='.length);
const cfgPath = path.resolve(argCfg || path.join(process.cwd(), 'yuque-sync.config.json'));
if (!fs.existsSync(cfgPath)) { console.error('找不到配置文件：' + cfgPath); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const books = (cfg.repos || []).map(r => r.name || r.url.split('/').pop());
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(p); } return out; }
let allRefs = 0, allBroken = 0;
for (const b of books) {
  const root = path.join(cfg.vault, b);
  if (!fs.existsSync(root)) { console.log(b, 'MISSING'); continue; }
  let refs = 0, broken = 0;
  const files = walk(root);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of new Set([...t.matchAll(/\]\(\.?\/?(img\/[^)\s]+)\)/g)].map(x => x[1]))) {
      refs++;
      if (!fs.existsSync(path.join(path.dirname(f), m))) broken++;
    }
  }
  allRefs += refs; allBroken += broken;
  const size = (function du(d) { let s = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); s += e.isDirectory() ? du(p) : fs.statSync(p).size; } return s; })(root) / 1048576;
  console.log(b.padEnd(8), 'md', String(files.length).padStart(3), 'refs', String(refs).padStart(3), 'broken', broken, 'size', size.toFixed(0) + 'MB');
}
console.log('TOTAL refs', allRefs, 'broken', allBroken);
