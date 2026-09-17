#!/usr/bin/env node
/**
 * [INPUT]: cards.html（含 .card 元素）或单页 HTML 目录；本机 Playwright chromium / Chrome / Edge
 * [OUTPUT]: 3:4 卡片 PNG（默认 1080x1440），stdout 输出结构化 JSON 结果
 * [POS]: 渲染层。只做 HTML -> PNG，不管分页与排版
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/render.mjs <cards.html> [选项]
 *   node scripts/render.mjs <slides目录> [选项]
 *
 * 选项:
 *   --out DIR       输出目录          默认: <输入文件同级>/png
 *   --only N        只渲染第 N 张    默认: 全部
 *   --width PX      视口宽            默认: 1080
 *   --height PX     视口高            默认: 1440
 *   --scale N       输出倍率          默认: 1（1080x1440 就是小红书原始尺寸）
 *   --chrome FILE   指定浏览器可执行文件
 *   --engine NAME   auto | playwright | chrome-cli   默认: auto
 *   --json          仅输出 JSON（默认就是）
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * 1. 浏览器探测
 * ------------------------------------------------------------------ */

function scoreChromiumDir(name) {
  // 优先完整版 chromium-*（element 截图最稳），headless_shell 次之
  const m = name.match(/^chromium(?:_headless_shell)?-(\d+)$/);
  if (!m) return null;
  const isShell = name.startsWith('chromium_headless_shell');
  return { version: parseInt(m[1], 10), isShell };
}

function candidateRels() {
  const rel = [];
  if (process.platform === 'win32') {
    rel.push('chrome-win64/chrome.exe', 'chrome-win/chrome.exe');
  } else if (process.platform === 'darwin') {
    rel.push(
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    rel.push('chrome-linux/chrome', 'chrome-linux64/chrome');
  }
  return rel;
}

function scanPlaywrightCache(root) {
  const found = [];
  if (!root || !fs.existsSync(root)) return found;
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return found;
  }
  for (const dir of entries) {
    const meta = scoreChromiumDir(dir);
    if (!meta) continue;
    for (const rel of candidateRels()) {
      const exe = path.join(root, dir, rel);
      if (fs.existsSync(exe)) {
        // 完整版加成，版本号越高越优先
        found.push({ exe, rank: meta.version * 10 + (meta.isShell ? 0 : 5) });
      }
    }
  }
  return found.sort((a, b) => b.rank - a.rank);
}

function systemBrowsers() {
  const list = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    list.push(
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [bin], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) list.push(r.stdout.trim());
    }
  }
  return list.filter((p) => p && fs.existsSync(p));
}

function findBrowser(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`指定的浏览器不存在: ${explicit}`);
    return explicit;
  }
  if (process.env.XHS_CHROME_EXECUTABLE) {
    return process.env.XHS_CHROME_EXECUTABLE;
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);

  for (const root of roots) {
    const hit = scanPlaywrightCache(root);
    if (hit.length) return hit[0].exe;
  }
  const sys = systemBrowsers();
  if (sys.length) return sys[0];
  throw new Error(
    '找不到可用的浏览器。请安装 Chrome，或运行 npx playwright install chromium，' +
      '也可以用 --chrome 指定浏览器路径。'
  );
}

/* ------------------------------------------------------------------ *
 * 2. playwright-core 加载（不污染用户环境，从托管目录解析）
 * ------------------------------------------------------------------ */

function loadPlaywright() {
  const bases = [];
  if (process.env.NODE_PATH) bases.push(...process.env.NODE_PATH.split(path.delimiter));
  bases.push(
    path.join(SKILL_ROOT, 'node_modules'),
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules')
  );
  for (const base of bases) {
    if (!base || !fs.existsSync(base)) continue;
    try {
      const req = createRequire(path.join(base, '_resolver.js'));
      return req('playwright-core');
    } catch {
      /* 继续试下一个 */
    }
  }
  try {
    return createRequire(import.meta.url)('playwright-core');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 3. 两种引擎
 * ------------------------------------------------------------------ */

/**
 * 截单张卡片。
 * 不用 elementHandle.screenshot：它要等元素「稳定」，含大图的卡片会一直不过，
 * 报 Protocol error (Page.captureScreenshot): Unable to capture screenshot。
 * 改成按 boundingBox 用 clip 截，不做稳定性检查，稳得多。
 */
/** 读 PNG 实际像素尺寸，用来校验截图有没有被静默裁短 */
function readPngSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.length < 24) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}

async function shootCard(page, handle, outPath) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('拿不到卡片位置');
  const clip = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.screenshot({ path: outPath, type: 'png', clip });
      return clip;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(250 * attempt);
    }
  }
  throw lastErr;
}

async function renderByPlaywright(pw, htmlPath, outDir, opts) {
  const browser = await pw.chromium.launch({
    executablePath: opts.chrome,
    headless: true,
    args: [
      '--font-render-hinting=none',
      '--disable-lcd-text',
      '--force-color-profile=srgb',
      // 稿件与图片常不在同一目录（Obsidian Vault 尤其如此），
      // 少了这个开关，file:// 页面读同源 file:// 图片会间歇性 ERR_FAILED
      '--allow-file-access-from-files',
    ],
  });

  const results = [];
  try {
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.scale,
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded' });

    // 等字体与图片就绪，否则会截到 fallback 字体或空白图位。
    // 但两者都必须有超时兜底：file:// 页面遇到中文路径的图片时，img 可能永远 pending
    // （既不触发 load 也不触发 error），没有兜底就会一直挂到 goto 超时、整批图都出不来。
    await page.evaluate(async () => {
      const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
      if (document.fonts && document.fonts.ready) await race(document.fonts.ready, 3000);
      await race(
        Promise.all(
          Array.from(document.images).map((img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise((res) => {
                  img.addEventListener('load', res, { once: true });
                  img.addEventListener('error', res, { once: true });
                })
          )
        ),
        8000
      );
    });
    await page.waitForTimeout(120);

    const cards = await page.$$('.card');
    if (!cards.length) throw new Error('页面里没有找到 .card 元素，无法出图');

    // 视口必须罩住整页。boundingBox() 返回「相对视口」的坐标，screenshot 的 clip
    // 要的是「相对文档」的坐标——只有页面完全在视口内、且未滚动时两者才一致。
    // 否则轻则静默截短（1440 变 1384，边线被吃掉），重则报 Clipped area is outside。
    // 预览页在卡片外面还有 padding/gap，总高必然大于单张卡片高，所以这一步是必需的。
    const pageH = await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      )
    );
    if (pageH > opts.height) {
      await page.setViewportSize({ width: opts.width, height: Math.ceil(pageH) + 8 });
      await page.waitForTimeout(200); // 等重排稳定，否则量到的位置还是旧的
    }

    const stem = path.basename(htmlPath, '.html');
    const scale = opts.scale || 1;
    for (let i = 0; i < cards.length; i += 1) {
      const no = i + 1;
      if (opts.only && opts.only !== no) continue;
      const outPath = path.join(outDir, `${stem}_${String(no).padStart(2, '0')}.png`);
      const clip = await shootCard(page, cards[i], outPath);

      // 校验落盘尺寸。被裁的图「看起来有内容」，只是边线少几十像素，
      // 不校验就发现不了——等发到小红书才看出尺寸不对，代价太大。
      const got = readPngSize(outPath);
      const want = { w: Math.round(clip.width * scale), h: Math.round(clip.height * scale) };
      if (got && (got.w !== want.w || got.h !== want.h)) {
        throw new Error(
          `第 ${no} 张尺寸不符：期望 ${want.w}x${want.h}，实际 ${got.w}x${got.h}。` +
            `多半是截图区域超出视口被裁，检查 render.mjs 里的视口扩展逻辑。`
        );
      }
      results.push({ index: no, file: outPath, width: clip.width, height: clip.height });
    }
  } finally {
    await browser.close();
  }
  return results;
}

function renderByChromeCli(chrome, htmlPath, outDir, opts) {
  const stem = path.basename(htmlPath, '.html');
  const outPath = opts.only && opts.only !== 1 ? null : path.join(outDir, `${stem}_01.png`);
  if (!outPath) return [];
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--allow-file-access-from-files',
    `--force-device-scale-factor=${opts.scale}`,
    `--window-size=${opts.width},${opts.height}`,
    '--virtual-time-budget=6000',
    `--screenshot=${outPath}`,
    pathToFileURL(htmlPath).href,
  ];
  const r = spawnSync(chrome, args, { encoding: 'utf8', timeout: 90000 });
  if (!fs.existsSync(outPath)) {
    throw new Error(`Chrome 命令行渲染失败: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
  return [{ index: 1, file: outPath, width: opts.width * opts.scale, height: opts.height * opts.scale }];
}

/* ------------------------------------------------------------------ *
 * 4. 入口
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const o = {
    input: null,
    out: null,
    only: 0,
    width: 1080,
    height: 1440,
    scale: 1,
    chrome: null,
    engine: 'auto',
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--only') o.only = parseInt(next(), 10);
    else if (a === '--width') o.width = parseInt(next(), 10);
    else if (a === '--height') o.height = parseInt(next(), 10);
    else if (a === '--scale') o.scale = parseFloat(next());
    else if (a === '--chrome') o.chrome = next();
    else if (a === '--engine') o.engine = next();
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  o.input = rest[0] || null;
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      '用法: node scripts/render.mjs <cards.html|slides目录> [--out DIR] [--only N] [--scale 2] [--chrome 路径] [--engine auto|playwright|chrome-cli]'
    );
    return;
  }
  if (!opts.input) {
    console.error('缺少输入。用法: node scripts/render.mjs <cards.html|slides目录>');
    process.exit(2);
  }
  const inputPath = path.resolve(opts.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`输入不存在: ${inputPath}`);
    process.exit(2);
  }

  const isDir = fs.statSync(inputPath).isDirectory();
  const htmlFiles = isDir
    ? fs
        .readdirSync(inputPath)
        .filter((f) => f.toLowerCase().endsWith('.html'))
        .sort()
        .map((f) => path.join(inputPath, f))
    : [inputPath];

  if (!htmlFiles.length) {
    console.error('目录里没有 HTML 文件');
    process.exit(2);
  }

  const outDir = path.resolve(opts.out || path.join(path.dirname(htmlFiles[0]), 'png'));
  fs.mkdirSync(outDir, { recursive: true });

  opts.chrome = findBrowser(opts.chrome);
  const pw = opts.engine === 'chrome-cli' ? null : loadPlaywright();

  const pngs = [];
  let engineUsed;

  if (pw && opts.engine !== 'chrome-cli') {
    engineUsed = 'playwright';
    for (const f of htmlFiles) {
      const r = await renderByPlaywright(pw, f, outDir, opts);
      pngs.push(...r);
    }
  } else {
    // 降级：需要每个卡片是独立 HTML 文件（build-cards 会生成 slides/）
    engineUsed = 'chrome-cli';
    if (htmlFiles.length === 1) {
      console.error(
        '[warn] 无 playwright-core，降级为 Chrome 命令行。\n' +
          '[warn] 请改传由 build-cards 生成的 slides/ 目录，才能逐张出图。'
      );
    }
    for (const f of htmlFiles) {
      pngs.push(...renderByChromeCli(opts.chrome, f, outDir, opts));
    }
  }

  const report = {
    ok: true,
    engine: engineUsed,
    browser: opts.chrome,
    outDir,
    size: `${opts.width * opts.scale}x${opts.height * opts.scale}`,
    count: pngs.length,
    pngs,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
