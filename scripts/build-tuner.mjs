#!/usr/bin/env node
/**
 * [INPUT]: assets/themes/*.css + assets/frames/*.css
 * [OUTPUT]: templates/tuner-data.js（调参台读的皮肤/边框清单。**生成物，不要手改**）
 * [POS]: 生成层。把 assets/ 下的视觉模板清单喂给 templates/theme-tuner.html
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/build-tuner.mjs
 *
 * ── 为什么要有这个脚本 ────────────────────────────────────────
 * 2026-09-17：调参台里有两处写死的清单，都跟 assets/ 目录脱节 ——
 *
 *   ① `PALETTES`：6 套「一键配色」预设，全是浅色底，写死在 HTML 里。
 *      新增一套深色皮肤后，调参台里**根本看不到它**。
 *   ② `FRAMES`：3 个边框预设，也是写死的。改名成「相纸框」之后这里没跟着改，
 *      于是同一件事在仓库里有两个名字。
 *
 * 现在清单由本脚本从 assets/ 现读生成，调参台只是消费方：
 *   · 新增皮肤 → 重跑本脚本 → 调参台里自动出现，配色预设也自动变成「真实皮肤」
 *   · 改边框名字 → 重跑本脚本 → 调参台跟着改，不会再有两个名字
 *
 * 调参台打开时若读不到本文件，会显示一条明确提示（而不是静默少一块 UI）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplates } from './lib/templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(SKILL_ROOT, 'templates', 'tuner-data.js');

/** 把 `:root` 声明文本解析成 { '--x': 'y' } */
function parseDecls(text) {
  const out = {};
  for (const part of String(text).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k.startsWith('--') && v) out[k] = v;
  }
  return out;
}

function main() {
  const TPL = loadTemplates(SKILL_ROOT);

  const themes = TPL.themes.map((t) => ({
    key: t.key,
    name: t.name,
    badges: t.badges,
    slug: t.slug,
    aliases: t.aliases,
    summary: t.summary,
    order: t.order,
    decls: parseDecls(t.decls),
  }));

  const frames = TPL.frames.map((f) => {
    const d = parseDecls(f.decls);
    return {
      key: f.key,
      name: f.name,
      aliases: f.aliases,
      summary: f.summary,
      order: f.order,
      w: d['--img-border-w'] || '',
      color: d['--img-border-color'] || '',
      shadow: d['--img-shadow'] || '',
    };
  });

  // 所有皮肤出现过的变量名并集 —— 调参台切换皮肤时先清掉这一批内联值。
  // 少了这一步，「暗夜 → 奶油蓝」之后 --mark-ink 会残留在深色值上
  // （只有暗夜定义了这个变量，不清理就没人把它改回来）。
  const themeVarKeys = [...new Set(themes.flatMap((t) => Object.keys(t.decls)))].sort();

  const js = `/* 生成物 —— 由 node scripts/build-tuner.mjs 从 assets/ 现读产出，不要手改。
   改皮肤/边框请改 assets/ 下的 css，然后重跑：
     node scripts/build-tuner.mjs   （刷新本文件）
     node scripts/build-gallery.mjs （刷新 docs/gallery.html）
     node scripts/build-preview.mjs （刷新 README 门面图）
*/
window.__XHS_TPL__ = ${JSON.stringify(
    { themes, frames, themeVarKeys, themeCount: themes.length, frameCount: frames.length },
    null,
    2
  )};
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, js, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        sizeKB: Math.round(Buffer.byteLength(js) / 1024),
        themes: themes.map((t) => `${t.key}${t.badges ? `(${t.badges})` : ''}`),
        frames: frames.map((f) => `${f.key}[${f.w}]`),
        themeVarKeys,
      },
      null,
      2
    )
  );
}

main();
