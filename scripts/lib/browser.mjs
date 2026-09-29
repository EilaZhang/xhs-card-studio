#!/usr/bin/env node
/**
 * [INPUT]: 无 —— 探测本机可用的 Chromium，并解析托管目录里的 playwright-core
 * [OUTPUT]: 具名导出 findBrowser / loadPlaywright / launchBrowser
 * [POS]: 基础设施层。浏览器探测与 playwright 解析的**唯一一份来源**，供
 *        render.mjs（出图）与 palette-from-image.mjs（取色）共用
 * [PROTOCOL]: 变更时更新此头部
 *
 * ── 为什么抽出来（2026-09-29）────────────────────────────
 * 原来 findBrowser() / loadPlaywright() 内联在 scripts/render.mjs 里，而 render.mjs
 * 末尾**无条件调用 main()** —— import 它会立刻开始出图，没法当模块用。
 * 取色脚本需要同一套探测逻辑，于是抽到这里。
 *
 * ⚠️ 浏览器探测只能有这一份来源。别再往新脚本里抄第二份 ——
 * 抄了就会出现「render 找得到浏览器、取色偏偏找不到」这种最难查的分裂。
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..', '..');

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

export function findBrowser(explicit) {
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

export function loadPlaywright() {
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
 * 3. 启动
 * ------------------------------------------------------------------ */

/**
 * 起一个 headless chromium，返回 { kind, browser, executable, close() }。
 *
 * 参数与 render.mjs 保持一致，尤其是 --force-color-profile=srgb ——
 * 取色脚本靠它保证「读到的像素 = 文件里的颜色」，不套任何色彩管理。
 */
export async function launchBrowser(opts = {}) {
  const pw = loadPlaywright();
  if (!pw) {
    throw new Error(
      '解析不到 playwright-core。它应当由 render.mjs 的依赖链提供；' +
        '若确实缺失，可用 --chrome 配合系统 Chrome 走 CLI 通道（取色脚本暂不支持）。'
    );
  }
  const executable = findBrowser(opts.chrome);
  const browser = await pw.chromium.launch({
    executablePath: executable,
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
  return {
    kind: 'playwright',
    browser,
    executable,
    close: () => browser.close(),
  };
}
