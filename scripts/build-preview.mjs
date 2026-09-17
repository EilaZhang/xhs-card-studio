#!/usr/bin/env node
/**
 * [INPUT]: examples/demo-gallery.md + assets/（全部皮肤）+ README.md + 浏览器
 * [OUTPUT]: docs/preview/*.png（README 用的预览图。**生成物，不要手改**）
 * [POS]: 生成层。README 的门面图统一由这里产出，并反过来校验 README 有没有写错
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/build-preview.mjs
 *
 * ── 为什么要有这个脚本（两段历史，都踩过） ──────────────────────
 *
 * ① 2026-09-17：README 的 4 张预览图风格不统一 —— 前 3 张是切换默认皮肤之前
 *    渲染的旧产物（白底红＝知识风），第 4 张是切换之后的（米黄蓝＝奶油蓝），
 *    一行里两种风格；而且第 4 张的 alt 还写着「相纸白框」，图里其实是细描边。
 *    根因：图是**手工从 outputs/ 复制**过来的，样式一改就过期，没人会发现。
 *
 * ② 2026-09-17 深夜：命名从 `01-theme-cream.png` 这种**带序号**的改成
 *    `theme-cream.png` 这种**不带序号**的。因为序号是按皮肤在目录里的顺序
 *    现算的（`i + 1`），于是「新增一套皮肤」会把后面所有文件挤着改名 ——
 *    README 里写的 `05-page-content.png` 那格被新皮肤的封面占了，**不报错，
 *    只是显示成另一张图**。静默错图比 404 难发现得多。
 *    现在文件名只由皮肤自己的 `@slug` 决定，加删皮肤互不影响。
 *
 * ── 因此本脚本最后一步会反过来验 README ──────────────────────
 * 生成完不撒手，接着读 README.md 核三件事：
 *   · README 引用的图都存在吗（不存在 → 硬错误，页面一定挂）
 *   · 生成的图都被引用了吗（没被引用 → 告警，通常是你加了皮肤忘了更新 README）
 *   · 皮肤预览图的 alt 里提到那套皮肤的名字了吗（没提到 → 告警，
 *     就是历史上「图是细描边、alt 写着相纸白框」那类错）
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
const README = path.join(SKILL_ROOT, 'README.md');
const TMP = path.join(SKILL_ROOT, 'outputs', '_preview');
const DEFAULT_THEME = 'default';

const TPL = loadTemplates(SKILL_ROOT);

/**
 * 跑子脚本。
 *
 * 这里必须把 stdout/stderr 抓住并在失败时抛出来 —— 不能像最初那样
 * `stdio: ['ignore','pipe','pipe']` 一吞了事。实测踩过一次：render.mjs 失败后
 * 只剩一句「没渲染出第 N 页」，真实原因（Chrome 起不来 / 尺寸被裁）全被吞掉，
 * 只能靠手工重跑同一条命令才看得见。同类的坑这个项目已经踩过两次
 * （见 HANDOFF：grep -c 吞掉错误信息、render.mjs 静默返回空输出）。
 */
const run = (script, args) => {
  try {
    return execFileSync(process.execPath, [path.join(SKILL_ROOT, 'scripts', script), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (e) {
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${script} 失败（退出码 ${e.status == null ? '?' : e.status}）\n` +
        `命令: node scripts/${script} ${args.join(' ')}\n` +
        (detail ? detail.slice(0, 2000) : '（子进程没有任何输出）')
    );
  }
};

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

/* ================================================================== *
 * README 反向校验
 * ================================================================== */

/**
 * 从 README 里抽出所有 <img ...> 标签里指向 docs/preview/ 的引用。
 * 只认 <img>，不认普通 markdown 链接 —— 我们要核的是「图」，不是超链接。
 */
function readmeImageRefs(md) {
  const refs = [];
  for (const m of String(md).matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\bsrc\s*=\s*"([^"]+)"/i);
    if (!src) continue;
    const file = src[1].match(/(?:^|\/)docs\/preview\/([^/"]+\.png)$/i);
    if (!file) continue;
    const alt = tag.match(/\balt\s*=\s*"([^"]*)"/i);
    refs.push({ file: file[1], alt: alt ? alt[1] : '', tag });
  }
  return refs;
}

/**
 * 核对 README 与本次生成的图是否对得上。
 * 返回 { errors, warnings } —— errors 会让脚本退出码非 0。
 */
function checkReadme(made, themesByFile) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(README)) {
    warnings.push(`没找到 README.md（${README}），跳过引用校验`);
    return { errors, warnings };
  }
  const refs = readmeImageRefs(fs.readFileSync(README, 'utf8'));
  if (!refs.length) {
    warnings.push('README.md 里没有引用任何 docs/preview/*.png —— 校验无从下手，确认一下是不是全删了');
    return { errors, warnings };
  }

  const madeSet = new Set(made.map((m) => m.name));
  const refSet = new Set(refs.map((r) => r.file));

  // ① README 引用了不存在的图 —— 页面上就是裂图，必须拦
  for (const r of refs) {
    if (!madeSet.has(r.file)) {
      const near = made.filter((m) => {
        const a = m.name.split(/[.-]/).sort().join('');
        const b = r.file.split(/[.-]/).sort().join('');
        return a === b;
      });
      const hint = near.length ? `　最接近的生成物是 ${near[0].name}` : '';
      errors.push(`README 引用了 docs/preview/${r.file}，但本次没有生成它${hint}`);
    }
  }

  // ② 生成了但 README 没引用 —— 通常是加了皮肤忘了更新 README
  for (const m of made) {
    if (!refSet.has(m.name)) {
      warnings.push(`生成了 docs/preview/${m.name}，但 README.md 没引用它（加皮肤/改版式后忘了更新 README？）`);
    }
  }

  // ③ 皮肤预览图的 alt 要提到那套皮肤的名字 —— 防「图换了 alt 没换」
  for (const r of refs) {
    const t = themesByFile.get(r.file);
    if (!t) continue;
    if (r.alt && !r.alt.includes(t.name)) {
      warnings.push(
        `docs/preview/${r.file} 是「${t.name}」的预览，但 README 的 alt 写的是「${r.alt}」—— 没提到这套皮肤的名字`
      );
    }
  }

  return { errors, warnings };
}

/* ================================================================== *
 * 主流程
 * ================================================================== */

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  // 旧的预览图先清掉。文件名现在由皮肤 slug 决定，理论上不会残留，
  // 但删过皮肤之后旧图会留下来变成孤儿 —— 一并清掉更省心。
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const made = [];
  /** 文件名 → 皮肤模板，供 README alt 校验用 */
  const themesByFile = new Map();

  // ① 每套皮肤一张封面：同一份内容、同一种版式，差异纯粹来自皮肤
  TPL.themes.forEach((t) => {
    const png = renderPage(t.key, 1, `cover-${t.slug}`);
    const name = `theme-${t.slug}.png`;
    fs.copyFileSync(png, path.join(OUT_DIR, name));
    made.push({ name, theme: t.key, page: 1 });
    themesByFile.set(name, t);
  });

  // ② 默认皮肤的内容页 + 配图页：说明「实际长什么样」（封面之外的版式）
  //    这两张的名字里故意不带皮肤名 —— 它们演示的是「版式」，不是某套皮肤
  [
    { pageNo: 2, kind: 'content' },
    { pageNo: 3, kind: 'figure' },
  ].forEach(({ pageNo, kind }) => {
    const png = renderPage(DEFAULT_THEME, pageNo, `page-${pageNo}`);
    const name = `page-${kind}.png`;
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

  const { errors, warnings } = checkReadme(made, themesByFile);

  const totalKB = Math.round(
    made.reduce((a, m) => a + fs.statSync(path.join(OUT_DIR, m.name)).size, 0) / 1024
  );

  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        outDir: OUT_DIR,
        count: made.length,
        totalKB,
        files: made.map((m) => `${m.name}  (${m.theme} · 第 ${m.page} 页 · 1080x1440)`),
        readmeErrors: errors,
        readmeWarnings: warnings,
      },
      null,
      2
    )
  );

  if (errors.length) {
    console.error(`\nREADME 与预览图对不上，去改 README.md：\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
}

main();
