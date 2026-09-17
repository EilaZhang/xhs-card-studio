#!/usr/bin/env node
/**
 * [INPUT]: examples/demo-gallery.md + assets/（全部皮肤）+ 浏览器
 * [OUTPUT]: docs/preview/*.png（README 用的预览图。**生成物，不要手改**）
 * [POS]: 生成层。README 的门面图统一由这里产出
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/build-preview.mjs
 *
 * 为什么要有这个脚本：
 * 2026-09-17 发现 README 的 4 张预览图风格不统一 —— 前 3 张是切换默认皮肤之前
 * 渲染的旧产物（白底红＝知识风），第 4 张是切换之后的（米黄蓝＝奶油蓝），
 * 一行里两种风格；而且第 4 张的 alt 还写着「相纸白框」，图里其实是细描边。
 * 根因：图是**手工从 outputs/ 复制**过来的，样式一改就过期，没人会发现。
 *
 * 现在：全部预览图由**同一份样张 + 现读的样式**生成，一条命令重跑即可。
 * 换默认皮肤、改配色、改边框之后，务必重跑本脚本，否则 README 又会开始骗人。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTemplates } from './lib/templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

const SAMPLE = path.join(SKILL_ROOT, 'examples', 'demo-gallery.md');
const OUT_DIR = path.join(SKILL_ROOT, 'docs', 'preview');
const TMP = path.join(SKILL_ROOT, 'outputs', '_preview');
const DEFAULT_THEME = 'default';

const TPL = loadTemplates(SKILL_ROOT);

const run = (script, args) =>
  execFileSync(process.execPath, [path.join(SKILL_ROOT, 'scripts', script), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** 跑一遍「稿件 → HTML → 指定页 PNG」，返回产出的 PNG 路径 */
function renderPage(themeKey, pageNo, tag) {
  const out = path.join(TMP, tag);
  fs.rmSync(out, { recursive: true, force: true });
  run('build-cards.mjs', [SAMPLE, '--theme', themeKey, '--out', out, '--no-slides']);
  run('render.mjs', [path.join(out, 'cards.html'), '--out', path.join(out, 'png'), '--only', String(pageNo)]);
  const png = path.join(out, 'png', `cards_${String(pageNo).padStart(2, '0')}.png`);
  if (!fs.existsSync(png)) throw new Error(`没渲染出第 ${pageNo} 页：${png}`);
  return png;
}

const readPngSize = (p) => {
  const b = fs.readFileSync(p).subarray(16, 24);
  return [b.readUInt32BE(0), b.readUInt32BE(4)];
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  // 旧的预览图先清掉 —— 文件名会变（数量从 4 张变 6 张），留着就是误导
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const made = [];

  // ① 每套皮肤一张封面：同一份内容、同一种版式，差异纯粹来自皮肤
  TPL.themes.forEach((t, i) => {
    const png = renderPage(t.key, 1, `cover-${t.slug}`);
    const name = `${String(i + 1).padStart(2, '0')}-theme-${t.slug}.png`;
    fs.copyFileSync(png, path.join(OUT_DIR, name));
    made.push({ name, theme: t.key, page: 1 });
  });

  // ② 默认皮肤的内容页 + 配图页：说明「实际长什么样」（封面之外的版式）
  const base = TPL.themes.length;
  [2, 3].forEach((pageNo, i) => {
    const png = renderPage(DEFAULT_THEME, pageNo, `page-${pageNo}`);
    const kind = pageNo === 2 ? 'content' : 'figure';
    const name = `${String(base + i + 1).padStart(2, '0')}-page-${kind}.png`;
    fs.copyFileSync(png, path.join(OUT_DIR, name));
    made.push({ name, theme: DEFAULT_THEME, page: pageNo });
  });

  fs.rmSync(TMP, { recursive: true, force: true });

  // 尺寸自校验：README 里写了 1080×1440，就得真的是
  const bad = made
    .map((m) => ({ ...m, size: readPngSize(path.join(OUT_DIR, m.name)) }))
    .filter((m) => m.size[0] !== 1080 || m.size[1] !== 1440);
  if (bad.length) {
    console.error(`有预览图尺寸不是 1080x1440：${bad.map((b) => `${b.name}=${b.size.join('x')}`).join(', ')}`);
    process.exit(1);
  }

  const totalKB = Math.round(
    made.reduce((a, m) => a + fs.statSync(path.join(OUT_DIR, m.name)).size, 0) / 1024
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        count: made.length,
        totalKB,
        files: made.map((m) => `${m.name}  (${m.theme} · 第 ${m.page} 页 · 1080x1440)`),
      },
      null,
      2
    )
  );
}

main();
