#!/usr/bin/env node
/**
 * [INPUT]: assets/base.css + assets/themes/*.css + assets/frames/*.css + examples/demo-gallery.md
 * [OUTPUT]: docs/gallery.html（视觉模板总览页。**生成物，不要手改**）
 * [POS]: 生成层。把「皮肤 × 配图边框」渲染成一页可对比的总览
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/build-gallery.mjs [--sample 稿件.md] [--out docs/gallery.html]
 *
 * 为什么是「生成」而不是「手写 + 截图」：
 * 2026-09-17 之前 README 的预览图是手工从 outputs/ 复制来的。默认皮肤一换成
 * 奶油蓝，前三张图还是旧的「知识风」（白底红），第四张却是新的奶油蓝 ——
 * 一页里两种风格，而且没人发现。根因是「图片」和「样式」之间没有强制关系。
 * 现在总览页从**真实渲染产物**生成：卡片标记由 build-cards.mjs 现跑，
 * 颜色由 assets/ 下的 css 现读，改样式后重跑本脚本即可，不存在过期一说。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTemplates } from './lib/templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : def;
};

const SAMPLE = path.resolve(argOf('--sample', path.join(SKILL_ROOT, 'examples', 'demo-gallery.md')));
const OUT = path.resolve(argOf('--out', path.join(SKILL_ROOT, 'docs', 'gallery.html')));
const TMP = path.join(SKILL_ROOT, 'outputs', '_gallery');

const TPL = loadTemplates(SKILL_ROOT);

/* ================================================================== *
 * 工具
 * ================================================================== */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const lin = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const h = String(hex).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  if (x == null || y == null) return null;
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
};

/** 从一段 :root 声明里取某个变量的值 */
const varOf = (decls, name) => {
  const m = String(decls).match(new RegExp(`--${name}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : '';
};

/** 把产物里写死的 file:///<技能根>/ 前缀改成本页可用的相对路径 */
function relUrls(html) {
  const rootUrl = pathToFileURL(SKILL_ROOT).href.replace(/\/$/, '');
  let out = html;
  for (const p of new Set([rootUrl + '/', encodeURI(rootUrl) + '/'])) out = out.split(p).join('../');
  return out;
}

/**
 * 校验皮肤里手写的对比度数字。
 *
 * 皮肤文件里有两处人工填写的比值，都不会跟着颜色更新：
 *
 *   ① 变量行尾注释     --accent: #6b9bc7;  后面缀着「（2.78:1）」
 *   ② 文件头「配色实测」表
 *        --accent     8.90:1   (需 >= 3)
 *        --mark-ink vs --mark-bg 10.52:1 (需 >= 4.5)
 *
 * 2026-09-17 实测过它们真的会烂：把苔绿的 --accent 临时改成紫色后重跑，
 * 本页算出来的比值变了，注释还稳稳写着「4.42:1」。注释于是变成假信息，比没有更糟。
 *
 * 这里把两处都重算一遍比对，不一致就报警。注释照留（在源码里就地可读，
 * 改色的人不用跳出去查总览页），只是不许它悄悄过期。
 *
 * 比对基准默认 --card-bg，与页面上 ratio 面板用的是同一个；
 * 要标别的底色，注释里写「对 --mark-bg 10.52:1」，表里写「--mark-ink vs --mark-bg 10.52:1」。
 * 没标数字的行不校验 —— 不强迫每一行都标。
 */
function checkRatioNotes(css, decls, file) {
  const out = [];
  const src = String(css);
  const verify = (name, noted, bgName, where) => {
    const actual = ratio(varOf(decls, name), varOf(decls, bgName));
    if (actual == null) return;
    if (Math.abs(actual - noted) > 0.01) {
      out.push(
        `${file} → --${name} ${where}写「${noted.toFixed(2)}:1」（对 --${bgName}），实测 ${actual.toFixed(2)}:1`
      );
    }
  };

  // 写法 ①：变量声明行尾的注释。限定在「--var: #hex;」这种行里，避免把正文数字误当注释
  const inline = /--([a-z0-9-]+)\s*:\s*#[0-9a-fA-F]{3,8}\s*;[^\n]*?\/\*([^*\n]*)\*\//g;
  for (const m of src.matchAll(inline)) {
    const c = m[2].match(/(?:对\s*--([a-z0-9-]+)\s*)?([0-9]+\.[0-9]+)\s*:\s*1/);
    if (c) verify(m[1], Number(c[2]), c[1] || 'card-bg', '注释');
  }

  // 写法 ②：文件头的「配色实测」表
  const tabular = /^\s*--([a-z0-9-]+)(?:\s+vs\s+--([a-z0-9-]+))?\s+([0-9]+\.[0-9]+)\s*:\s*1\b/gm;
  for (const m of src.matchAll(tabular)) {
    verify(m[1], Number(m[3]), m[2] || 'card-bg', '表里');
  }

  return out;
}

/* ================================================================== *
 * 跑真实管线，取卡片标记
 * ================================================================== */

function buildSample(themeKey, frameKey) {
  const out = path.join(TMP, `${themeKey}__${frameKey}`);
  fs.rmSync(out, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      path.join(SKILL_ROOT, 'scripts', 'build-cards.mjs'),
      SAMPLE,
      '--theme', themeKey,
      '--frame', frameKey,
      '--out', out,
      '--no-slides',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const html = fs.readFileSync(path.join(out, 'cards.html'), 'utf8');
  const inner = html.split('<div class="deck">')[1].split('<script')[0].replace(/<\/div>\s*$/, '');
  const cards = relUrls(inner)
    .split(/(?=<section class="card)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  return { cards, plan };
}

/* ================================================================== *
 * 页面片段
 * ================================================================== */

const SCALE = 0.1944; // 1080 × 0.1944 = 210px

function shot(cardHtml, decls) {
  return `<div class="shot"><div class="scope" style="${esc(decls)}"><div class="deck">${cardHtml}</div></div></div>`;
}

function ratiosHtml(decls) {
  const bg = varOf(decls, 'card-bg');
  const rows = [
    ['--accent 序号/标签', varOf(decls, 'accent'), 3.0],
    ['--ink-soft 副标题', varOf(decls, 'ink-soft'), 4.5],
    ['--ink 正文', varOf(decls, 'ink'), 7.0],
  ];
  return `<ul class="ratio">${rows
    .map(([label, v, need]) => {
      const r = ratio(v, bg);
      if (r == null) return '';
      const ok = r >= need;
      return `<li><span>${esc(label)}</span><b class="${ok ? 'ok' : 'warn'}">${r.toFixed(2)}:1 ${ok ? '✓' : '△'}</b></li>`;
    })
    .join('')}</ul>`;
}

function themeBlock(t, cards) {
  const sw = ['card-bg', 'ink', 'accent', 'mark-bg']
    .map((n) => `<span style="background:${esc(varOf(t.decls, n))}" title="--${n}: ${esc(varOf(t.decls, n))}"></span>`)
    .join('');
  return `<article class="tpl">
  <div class="tpl__info">
    <h3>${esc(t.name)}${t.badges ? `<span class="badge">${esc(t.badges)}</span>` : ''}</h3>
    <p class="tpl__file">${esc(t.file)}</p>
    <p class="tpl__desc">${esc(t.summary)}</p>
    <p class="tpl__use"><b>适合</b>　${esc(t.use)}</p>
    <div class="sw">${sw}</div>
    ${ratiosHtml(t.decls)}
    <p class="tpl__cmd"><code>--theme ${esc(t.key)}</code></p>
    <p class="tpl__alias">别名：${esc(t.aliases.join(' / '))}</p>
  </div>
  <div class="tpl__cards">${cards.join('')}</div>
</article>`;
}

function frameBlock(f, cards, plan) {
  return `<article class="tpl">
  <div class="tpl__info">
    <h3>${esc(f.name)}</h3>
    <p class="tpl__file">${esc(f.file)}</p>
    <p class="tpl__desc">${esc(f.summary)}</p>
    <p class="tpl__use"><b>适合</b>　${esc(f.use)}</p>
    <ul class="ratio">
      <li><span>边框粗细</span><b>${esc(varOf(f.decls, 'img-border-w'))}</b></li>
      <li><span>边框颜色</span><b>${esc(varOf(f.decls, 'img-border-color'))}</b></li>
      <li><span>投影</span><b>${varOf(f.decls, 'img-shadow') === 'none' ? '无' : '有'}</b></li>
      <li><span>本样张页数</span><b>${plan.count}</b></li>
    </ul>
    <p class="tpl__cmd"><code>--frame ${esc(f.key)}</code></p>
    <p class="tpl__alias">别名：${esc(f.aliases.join(' / '))}</p>
  </div>
  <div class="tpl__cards">${cards.join('')}</div>
</article>`;
}

/* ================================================================== *
 * 主流程
 * ================================================================== */

function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.error(`样张稿件不存在: ${SAMPLE}`);
    process.exit(2);
  }
  fs.mkdirSync(TMP, { recursive: true });

  const warnings = [];

  // 皮肤注释里手写的对比度数字，重算一遍比对（详见 checkRatioNotes 的说明）
  const ratioNotes = TPL.themes.flatMap((t) => checkRatioNotes(t.css, t.decls, t.file));

  // 皮肤：每套都跑一遍，取它自己的分页结果（不同皮肤分页可能不同）
  const themeBlocks = TPL.themes.map((t) => {
    const { cards } = buildSample(t.key, 'hairline');
    return themeBlock(t, cards.map((c) => shot(c, t.decls)));
  });

  // 边框：统一用默认皮肤，只换边框 —— 同一份内容才好比
  const frameBlocks = TPL.frames.map((f) => {
    const { cards, plan } = buildSample('default', f.key);
    // 只展示带配图的那一页，边框差异才看得出
    const figIdx = cards.findIndex((c) => c.includes('<img'));
    const pick = figIdx > -1 ? [cards[figIdx]] : cards.slice(-1);
    return frameBlock(f, pick.map((c) => shot(c, f.decls)), plan);
  });

  // 安全网：产物里若仍残留 file:// 绝对路径，说明有技能目录之外的文件被引用了
  // （历史上真出过一次：outputs/ 里的 HTML 泄漏了本机用户名和私人目录结构）
  const all = [...themeBlocks, ...frameBlocks].join('\n');
  const leaks = all.match(/file:\/\/\/[^"'\s)]+/g);
  if (leaks) warnings.push(`产物里仍有 ${leaks.length} 处 file:// 绝对路径：${[...new Set(leaks)].slice(0, 3).join(' , ')}`);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>xhs-card-studio · 视觉模板总览</title>
<link rel="stylesheet" href="../assets/base.css">
<link rel="stylesheet" href="../assets/gallery-shell.css">
<style>
/* 总览页自己的样式。
   这里**只写排布与缩放，颜色一律走 var(--gal-*)** —— 那些变量的定义在
   assets/gallery-shell.css，是一份可以直接编辑的普通 CSS。
   想换这个页面的观感，改那个文件重跑本脚本即可，不用碰这里的 JS。 */
* { box-sizing: border-box; }
body.gal {
  margin: 0; padding: 44px 30px 96px;
  background: var(--gal-page-bg); color: var(--gal-ink);
  font: 15px/1.7 "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}
.gal h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: -.01em; }
.gal .lede { margin: 0 0 8px; max-width: 820px; color: var(--gal-ink-soft); }
.gal .note { margin: 0 0 4px; font-size: 13px; color: var(--gal-ink-faint); }
.gal code { background: var(--gal-code-bg); padding: 1px 6px; border-radius: 4px; font-size: 12.5px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
.gal h2 { margin: 54px 0 6px; padding-bottom: 10px; font-size: 21px; border-bottom: 1px solid var(--gal-rule); }
.gal .hint { margin: 0 0 22px; color: var(--gal-ink-mute); font-size: 14px; }
.gal .warnbox { margin: 18px 0 0; padding: 10px 14px; background: var(--gal-warnbox-bg);
  border: 1px solid var(--gal-warnbox-border); border-radius: 8px; color: var(--gal-warnbox-ink); font-size: 13px; }
.gal .warnbox--note { background: var(--gal-infobox-bg); border-color: var(--gal-infobox-border); color: var(--gal-infobox-ink); }
.gal .warnbox ul { margin: 8px 0 0; padding-left: 20px; }
.gal .warnbox li { margin: 4px 0; }
.gal .warnbox code { background: var(--gal-code-bg-soft); }

.tpl { display: flex; gap: 26px; align-items: flex-start; background: var(--gal-surface);
  border: 1px solid var(--gal-border); border-radius: 14px; padding: 22px; margin: 0 0 18px; }
.tpl__info { flex: 0 0 272px; }
.tpl__info h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 5px; font-size: 19px; }
.badge { padding: 2px 8px; border-radius: 20px; background: var(--gal-badge-bg); color: var(--gal-badge-ink);
  font-size: 11px; font-weight: 600; }
.tpl__file { margin: 0 0 10px; color: var(--gal-ink-faint); font-size: 12px;
  font-family: ui-monospace, Consolas, monospace; }
.tpl__desc { margin: 0 0 10px; color: var(--gal-ink-strong); }
.tpl__use { margin: 0 0 12px; color: var(--gal-ink-soft); font-size: 13px; }
.tpl__use b { color: var(--gal-ink); }
.tpl__cmd { margin: 12px 0 6px; }
.tpl__cmd code { background: var(--gal-cmd-bg); color: var(--gal-cmd-ink); padding: 5px 11px; border-radius: 7px; }
.tpl__alias { margin: 0; color: var(--gal-ink-faint); font-size: 12px; }
.sw { display: flex; gap: 6px; margin: 0 0 12px; }
.sw span { width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--gal-swatch-border); }
.ratio { list-style: none; margin: 0; padding: 0; font-size: 12.5px; color: var(--gal-ink-soft); }
.ratio li { display: flex; justify-content: space-between; gap: 12px;
  padding: 3px 0; border-bottom: 1px dashed var(--gal-rule-faint); }
.ratio b { font-family: ui-monospace, Consolas, monospace; font-weight: 600; }
.ratio .ok { color: var(--gal-ok); }
.ratio .warn { color: var(--gal-warn); }

.tpl__cards { display: flex; flex-wrap: wrap; gap: 14px; }
.shot { width: 210px; height: 280px; overflow: hidden; border-radius: 8px;
  border: 1px solid var(--gal-border); background: var(--gal-surface); }
.shot .scope { width: 1080px; transform: scale(${SCALE}); transform-origin: top left; }
.scope .deck { flex-direction: row; gap: 0; padding: 0; }
.shot .card { box-shadow: none; }  /* 出图里本来就没有投影，这里也不显示 */
</style>
</head>
<body class="gal">
<h1>视觉模板总览</h1>
<p class="lede">共 <b>${TPL.themes.length}</b> 套皮肤 × <b>${TPL.frames.length}</b> 种配图边框 = <b>${TPL.themes.length * TPL.frames.length}</b> 种组合。下面每张卡片都是真实渲染产物，不是截图素材。</p>
<p class="note">本页由 <code>node scripts/build-gallery.mjs</code> 生成，样式改完重跑一遍即可。样张稿件：<code>${esc(path.relative(SKILL_ROOT, SAMPLE).replace(/\\/g, '/'))}</code></p>
${warnings.length ? `<div class="warnbox">⚠️ ${warnings.map(esc).join('；')}</div>` : ''}
${ratioNotes.length ? `<div class="warnbox warnbox--note">
<strong>有 ${ratioNotes.length} 处皮肤注释里的对比度已经过期</strong> —— 颜色改了但注释没跟着改。下面这份比值是实测的，可信；源码注释里那个已不作数：
<ul>${ratioNotes.map((s) => `<li><code>${esc(s)}</code></li>`).join('')}</ul>
</div>` : ''}

<h2>皮肤</h2>
<p class="hint">同一份样张、同一种边框（默认细描边），只换皮肤。右侧是该皮肤自己的分页结果。</p>
${themeBlocks.join('\n')}

<h2>配图边框</h2>
<p class="hint">同一份样张、同一套皮肤（默认奶油蓝），只换边框。肤色/底色不同的皮肤下，边框色会跟着皮肤的变量走。</p>
${frameBlocks.join('\n')}
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        sizeKB: Math.round(Buffer.byteLength(html) / 1024),
        themes: TPL.themes.map((t) => t.key),
        frames: TPL.frames.map((f) => f.key),
        ratioNotes,
        warnings,
      },
      null,
      2
    )
  );
}

main();
