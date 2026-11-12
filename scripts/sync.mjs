#!/usr/bin/env node
/**
 * 语雀 → Obsidian 同步
 * 1) yuque-dl 拉取到 staging（默认 %LOCALAPPDATA%/yuque-to-obsidian/staging-<hash>，可用 config.staging 覆盖），
 *    原样保留它自己的目录结构与图片布局，供增量比对
 * 2) 补图：yuque-dl 漏掉的图片，从文档 API 取原图地址，补到笔记所在目录（与笔记里的相对路径一致）
 * 3) 发布：去掉 _<id> 后缀、重名自动编号、加 frontmatter、转 callout、按目录镜像图片、生成 index.md
 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const listBooks = args.includes('--list-books');
const argVal = (name) => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const configPath = path.resolve(argVal('config') || path.join(process.cwd(), 'yuque-sync.config.json'));
if (!fs.existsSync(configPath)) {
  console.error('找不到配置文件：' + configPath + '\n用法：node sync.mjs --config=<yuque-sync.config.json>');
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
// --list-books 只读账号的库清单，既不需要 vault 也不需要 repos
if (!cfg.vault && !listBooks) { console.error('配置缺少 vault 字段：' + configPath); process.exit(2); }
if (!listBooks && (!Array.isArray(cfg.repos) || !cfg.repos.length)) { console.error('配置缺少 repos 数组：' + configPath); process.exit(2); }

const vault = cfg.vault ? path.resolve(cfg.vault) : '';
// staging 默认放在本地缓存目录，避免跟着 vault 一起被 OneDrive / iCloud 同步
function defaultStaging(vaultPath) {
  const base = process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const hash = crypto.createHash('sha1').update(path.resolve(vaultPath).toLowerCase()).digest('hex').slice(0, 8);
  return path.join(base, 'yuque-to-obsidian', 'staging-' + hash);
}
const stagingRoot = path.resolve(cfg.staging || defaultStaging(vault));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// 企业版语雀的 cookie 名不是 _yuque_session，用 config.cookieKey 覆盖
const COOKIE_KEY = cfg.cookieKey || '_yuque_session';
const COOKIE = COOKIE_KEY + '=' + (cfg.session || '');
const only = argVal('only');
const publishOnly = args.includes('--publish-only');

const log = [];
const say = (m) => { const l = new Date().toLocaleString('zh-CN', { hour12: false }) + ' ' + m; log.push(l); console.log(l); };

// ---------- 文本转换 ----------
const CALL = { info: 'note', tip: 'tip', warning: 'warning', danger: 'danger', success: 'tip', error: 'danger', note: 'note' };
function convertBlocks(text) {
  const out = [];
  let depth = 0;
  for (const line of text.split(/\r?\n/)) {
    const open = line.match(/^:::([A-Za-z0-9]+)\s*$/);
    if (open) { const k = CALL[open[1]] || 'note'; out.push('> [!' + k.charAt(0).toUpperCase() + k.slice(1) + ']'); depth++; continue; }
    if (/^:::\s*$/.test(line) && depth > 0) { depth--; out.push(''); continue; }
    out.push(depth > 0 ? (line.trim() ? '> ' + line : '>') : line);
  }
  return out.join('\n');
}
const stripTags = (t) => t.replace(/<\/?font\b[^>]*>/gi, '').replace(/<span\b[^>]*>|<\/span>/gi, '');

function transform(md, meta) {
  let text = md.replace(/\r?\n/g, '\n');
  const fm = ['---', 'yuque_title: ' + JSON.stringify(meta.title), 'yuque_updated: ' + JSON.stringify(meta.updated || ''), 'yuque_url: ' + JSON.stringify(meta.url || ''), '---', ''].join('\n');
  text = text.replace(/^---\n[\s\S]*?\n---\n+/, '');
  text = fm + '\n' + text.trimStart();
  text = convertBlocks(stripTags(text));
  return text.replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

// ---------- 语雀接口 ----------
async function books() {
  const r = await fetch('https://www.yuque.com/api/mine/book_stacks', { headers: { cookie: COOKIE, 'user-agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const map = new Map();
  for (const s of j.data) for (const b of s.books || []) map.set(b.slug, { id: b.id, name: b.name, items: b.items_count, public: b.public });
  return map;
}

async function docImages(slug, bookId) {
  const u = 'https://www.yuque.com/api/docs/' + slug + '?book_id=' + bookId + '&merge_dynamic_data=false&mode=markdown';
  const r = await fetch(u, { headers: { cookie: COOKIE, 'user-agent': UA } });
  if (!r.ok) return [];
  const j = await r.json();
  const sc = (j.data && j.data.sourcecode) || '';
  return [...new Set([...sc.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]))];
}

const keyOf = (n) => n.replace(/-\d+(\.[a-z0-9]+)$/i, '$1').toLowerCase();
const baseName = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch { return ''; } };

async function download(url, dest) {
  for (let i = 0; i < 3; i++) {
    try {
      const headers = { 'user-agent': UA };
      if (url.includes('nlark.com')) headers.referer = 'https://www.yuque.com/';
      const r = await fetch(url, { headers });
      if (!r.ok) { await new Promise(s => setTimeout(s, 400)); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch { await new Promise(s => setTimeout(s, 600 * (i + 1))); }
  }
  return false;
}

const readProgress = (bookDir) => {
  try { return JSON.parse(fs.readFileSync(path.join(bookDir, 'progress.json'), 'utf8')); } catch { return []; }
};
const refsOf = (text) => [...new Set([...text.matchAll(/\]\(\.?\/?(img\/[^)\s]+)\)/g)].map(m => m[1]))];

// ---------- 补图（补到笔记所在目录，保持相对路径） ----------
async function fixImages(bookDir, bookId) {
  const prog = readProgress(bookDir);
  let filled = 0, failed = 0;
  const jobs = [];
  for (const entry of prog) {
    if (!entry.path.endsWith('.md')) continue;
    const file = path.join(bookDir, entry.path);
    if (!fs.existsSync(file)) continue;
    const dir = path.dirname(file);
    const missing = refsOf(fs.readFileSync(file, 'utf8')).filter(rel => !fs.existsSync(path.join(dir, rel)));
    if (missing.length && entry.toc && entry.toc.url) jobs.push({ entry, dir, missing });
  }
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      let urls = [];
      try { urls = await docImages(job.entry.toc.url, bookId); } catch {}
      const map = new Map(urls.map(u => [keyOf(baseName(u)), u]));
      const used = new Set();
      const ordered = urls.length === job.missing.length ? urls : [];
      for (const rel of job.missing) {
        let u = map.get(keyOf(path.basename(rel)));
        if (!u && ordered.length) u = ordered.find(x => !used.has(x));
        if (u) used.add(u);
        if (!u) { failed++; continue; }
        if (await download(u, path.join(job.dir, rel))) filled++; else failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  // 清理根目录 img 里没有被任何根级笔记引用的文件（旧版本误下载的重复图）
  const rootImg = path.join(bookDir, 'img');
  if (fs.existsSync(rootImg)) {
    const used = new Set();
    for (const entry of prog) {
      if (!entry.path.endsWith('.md') || entry.path.includes('/')) continue;
      const file = path.join(bookDir, entry.path);
      if (!fs.existsSync(file)) continue;
      for (const rel of refsOf(fs.readFileSync(file, 'utf8'))) used.add(path.resolve(bookDir, rel).toLowerCase());
    }
    (function prune(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { prune(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); continue; }
        if (!used.has(path.resolve(p).toLowerCase())) { try { fs.rmSync(p); failed--; } catch {} }
      }
    })(rootImg);
  }
  return { filled, failed };
}

// ---------- 发布 ----------
function plan(prog) {
  const docs = prog.filter(e => e.path.endsWith('.md') && Array.isArray(e.rawPathTitleList) && e.rawPathTitleList.length);
  const claimed = new Map();
  const out = [];
  const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+$/, '') || '未命名';
  for (const e of [...docs].sort((a, b) => a.path.localeCompare(b.path))) {
    const titles = e.rawPathTitleList.map(safe);
    const ids = e.pathIdList || [];
    const dirs = [];
    for (let i = 0; i < titles.length; i++) {
      const parent = dirs.join('/');
      const id = ids[i] || String(i);
      const isFile = i === titles.length - 1;
      let name = titles[i];
      for (let n = 2; ; n++) {
        const key = parent.toLowerCase() + '|' + name.toLowerCase();
        const owner = claimed.get(key);
        if (!owner || owner === id) { claimed.set(key, id); break; }
        name = titles[i] + ' (' + n + ')';
      }
      if (isFile) dirs.push(name + '.md'); else dirs.push(name);
    }
    out.push({ entry: e, rel: dirs.join('/') });
  }
  return out;
}

function publish(bookName, bookDir, baseUrl) {
  const items = plan(readProgress(bookDir));
  const outRoot = path.join(vault, bookName);
  fs.mkdirSync(outRoot, { recursive: true });

  // staging 目录 → 发布目录 的映射（含根目录），用于镜像每层自己的 img/
  const dirMap = new Map([[path.resolve(bookDir), outRoot]]);
  const seen = new Set();
  let written = 0, unchanged = 0, skipped = 0;
  for (const it of items) {
    const srcFile = path.join(bookDir, it.entry.path);
    if (!fs.existsSync(srcFile)) { skipped++; continue; }
    const stagingParts = it.entry.path.split('/');
    const cleanParts = it.rel.split('/');
    for (let i = 0; i < stagingParts.length - 1; i++) {
      const from = path.resolve(bookDir, ...stagingParts.slice(0, i + 1));
      const to = path.join(outRoot, ...cleanParts.slice(0, i + 1));
      if (!dirMap.has(from)) dirMap.set(from, to);
    }
    const meta = {
      title: it.entry.rawPathTitleList[it.entry.rawPathTitleList.length - 1],
      updated: it.entry.contentUpdatedAt ? fmtDate(it.entry.contentUpdatedAt) : '',
      url: it.entry.toc && it.entry.toc.url ? baseUrl + '/' + it.entry.toc.url : ''
    };
    const dest = path.join(outRoot, it.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const next = transform(fs.readFileSync(srcFile, 'utf8'), meta);
    // 内容没变就不写，避免 OneDrive 反复上传
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === next) unchanged++;
    else { fs.writeFileSync(dest, next, 'utf8'); written++; }
    seen.add(it.rel);
  }

  let copied = 0;
  for (const [from, to] of dirMap) {
    for (const sub of ['img', 'attachments']) {
      const s = path.join(from, sub);
      if (!fs.existsSync(s)) continue;
      (function cp(a, b) {
        fs.mkdirSync(b, { recursive: true });
        for (const e of fs.readdirSync(a, { withFileTypes: true })) {
          const p1 = path.join(a, e.name), p2 = path.join(b, e.name);
          if (e.isDirectory()) { cp(p1, p2); continue; }
          try {
            if (fs.existsSync(p2) && fs.statSync(p1).size === fs.statSync(p2).size) continue;
            fs.copyFileSync(p1, p2); copied++;
          } catch {}
        }
      })(s, path.join(to, sub));
    }
  }

  // 清理语雀里已删除/改名的笔记。plan 为空时跳过，避免把整个库抹掉
  let removed = 0;
  if (items.length) {
    (function prune(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { prune(p); try { if (!fs.readdirSync(p).length) fs.rmdirSync(p); } catch {} continue; }
        if (!e.name.endsWith('.md') || e.name === 'index.md') continue;
        const rel = path.relative(outRoot, p).split(path.sep).join('/');
        if (!seen.has(rel)) { try { fs.rmSync(p); removed++; } catch {} }
      }
    })(outRoot);
  }

  if (items.length) writeIndex(outRoot, items);
  // progress.json 里的路径与实际 staging 目录不一致（语雀侧改过标题/目录名后会出现），
  // 这些笔记会被静默跳过；必须报出来，否则同步显示“未变”而内容其实是旧的
  if (skipped) say('  ⚠ ' + skipped + ' 篇在 staging 里找不到源文件，未发布（progress.json 与目录不一致，删掉 staging/' + bookName + ' 重跑即可修复）');
  return { docs: seen.size, written, unchanged, copied, removed, skipped };
}

const fmtDate = (iso) => {
  const d = new Date(iso), p2 = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
};

function writeIndex(outRoot, items) {
  const tree = new Map();
  for (const it of items) {
    const parts = it.rel.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.has(parts[i])) node.set(parts[i], new Map());
      node = node.get(parts[i]);
    }
    node.set(parts[parts.length - 1], null);
  }
  const lines = [];
  (function render(node, depth, base) {
    for (const [name, child] of node) {
      if (child === null) lines.push('  '.repeat(depth) + '- [' + name.replace(/\.md$/, '') + '](' + encodeURI(base + name) + ')');
      else { lines.push('  '.repeat(depth) + '- **' + name + '**'); render(child, depth + 1, base + name + '/'); }
    }
  })(tree, 0, '');
  fs.writeFileSync(path.join(outRoot, 'index.md'), '# ' + path.basename(outRoot) + '\n\n' + lines.join('\n') + '\n', 'utf8');
}

// ---------- 主流程 ----------
async function main() {
const bookMap = await books().catch(e => { say('读取知识库列表失败：' + e.message); return new Map(); });

if (listBooks) {
  // 列出账号下所有知识库，方便挑选要同步的库
  if (!bookMap.size) {
    console.error('读取知识库列表失败：没有登录态或 _yuque_session 已过期。\n公开知识库不需要登录 —— 跳过 --list-books，直接把知识库 URL 写进 config.repos。');
    // 不要 process.exit()：此时 fetch 的句柄还在关闭，Windows 上会触发 libuv 断言崩溃
    process.exitCode = 1;
    return;
  }
  for (const [slug, b] of bookMap) console.log([b.name, slug, (b.items || 0) + ' 篇', b.public ? '公开' : '私密'].join('\t'));
  return;
}

// 用户从浏览器复制来的 URL 常带尾部斜杠，比对前先去掉，否则 --only 静默匹配不到
const repos = (cfg.repos || []).filter(r => !only || r.url.replace(/\/+$/, '').endsWith('/' + only));
if (!repos.length) { say('配置里没有可同步的 repos'); process.exitCode = 2; return; }

let ok = true, totalDocs = 0, totalImg = 0, totalCopied = 0;
const details = [];

for (const repo of repos) {
  const slug = repo.url.replace(/\/+$/, '').split('/').pop();
  const info = bookMap.get(slug) || { name: repo.name || slug, id: null };
  const bookName = repo.name || info.name;
  const stagingBook = path.join(stagingRoot, bookName);
  fs.mkdirSync(stagingBook, { recursive: true });

  let im = { filled: 0, failed: 0 };
  if (!publishOnly) {
    say('【' + bookName + '】拉取 ' + repo.url);
    let cmd = 'yuque-dl "' + repo.url + '" -d "' + stagingRoot + '"';
    if (cfg.incremental !== false) cmd += ' --incremental';
    if (cfg.cookieKey && cfg.cookieKey !== '_yuque_session') cmd += ' -k="' + cfg.cookieKey + '"';
    if (cfg.session) cmd += ' --token="' + cfg.session + '"';
    if (cfg.password) cmd += ' -p="' + cfg.password + '"';
    const r = spawnSync(cmd, { encoding: 'utf8', shell: true, maxBuffer: 128 * 1024 * 1024 });
    const out = ((r.stdout || '') + (r.stderr || '')).slice(-20000).replace(/\u001b\[[0-9;]*m/g, '');
    // 命令不存在时退出码各平台不同，靠输出文本判断，别让用户看到一屏 "staging 缺少 progress.json"
    if (r.error || /不是内部或外部命令|command not found|not recognized as an internal/i.test(out)) {
      say('  找不到 yuque-dl：先 npm i -g yuque-dl'); ok = false; details.push(bookName + '：未安装 yuque-dl'); continue;
    }
    if (/未登录|登录已过期|401|Unauthorized|captcha/i.test(out)) { say('  认证失败：_yuque_session 可能已过期'); ok = false; details.push(bookName + '：认证失败'); continue; }
    if (r.status !== 0) say('  yuque-dl 退出码 ' + r.status);
    im = await fixImages(stagingBook, info.id);
  }

  if (!fs.existsSync(path.join(stagingBook, 'progress.json'))) {
    say('  staging 里没有 progress.json（还没下载过或下载失败），跳过发布以免清空目录');
    ok = false;
    details.push(bookName + '：缺少 staging');
    continue;
  }

  let pub;
  try { pub = publish(bookName, stagingBook, repo.url.replace(/\/+$/, '')); }
  catch (e) { say('  发布失败：' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); ok = false; continue; }

  totalDocs += pub.docs; totalImg += im.filled; totalCopied += pub.copied;
  say('  发布 ' + pub.docs + ' 篇（写入 ' + pub.written + '，未变 ' + pub.unchanged + '，删除 ' + pub.removed + '），补图 ' + im.filled + '，新增资源 ' + pub.copied);
  details.push(bookName + '：' + pub.docs + ' 篇');
}

// vault 可能还不存在（路径新写或写错）；先建出来，别在最后一步抛未捕获的 ENOENT
fs.mkdirSync(vault, { recursive: true });
fs.mkdirSync(path.dirname(configPath), { recursive: true });
const status = ['# 语雀同步状态', '', '- 上次运行：' + new Date().toLocaleString('zh-CN', { hour12: false }), '- 结果：' + (ok ? '成功' : '失败'), '- 文档总数：' + totalDocs, '- 本次补图：' + totalImg, ...details.map(d => '- ' + d), ''].join('\n');
fs.writeFileSync(path.join(vault, '_同步状态.md'), status, 'utf8');
fs.appendFileSync(path.join(path.dirname(configPath), 'sync.log'), log.join('\n') + '\n');
// 机器可读的收尾摘要，方便调用方判断结果
console.log('RESULT ' + JSON.stringify({ ok, vault, docs: totalDocs, images: totalImg, books: details }));
process.exitCode = ok ? 0 : 1;
}

await main();
