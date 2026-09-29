#!/usr/bin/env node
/**
 * [INPUT]: 一张配色卡图片（PNG/JPG/WebP/GIF/BMP，纯色块最好）
 * [OUTPUT]: 候选色清单 + 角色分配 + 12 个槽位 + 对比度自检；--write 时另落 assets/themes/_draft/<slug>.css
 * [POS]: 取色层 + 映射层的命令行外壳。算法在 lib/（color.mjs 管颜色数学，palette.mjs 管派色），
 *        本文件只管参数、打印、落盘。
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/palette-from-image.mjs <图片> [选项]
 *
 * 取色选项:
 *   --k N            量化簇数              默认 12
 *   --max-side PX    取色前缩到的最长边      默认 240（够用且快）
 *   --min-share P    占比低于此值的当碎色丢掉  默认 0.02
 *   --merge-e N      色差 < N 的两个簇合并    默认 6（CIE76 ΔE，≈ 并排才看得出）
 *   --top N          候选清单最多列几条      默认 12
 *   --ignore-extremes 丢掉接近纯黑/纯白的簇（抗锯齿描边、纸白边常见）
 *   --smooth         缩小时启用平滑插值（**默认关闭**，理由见下）
 *   --chrome FILE    指定浏览器可执行文件
 *
 * 派色选项:
 *   --bg N|#hex      指定底色用哪个候选      （不指定则按占比猜，并标出置信度）
 *   --ink N|#hex     指定字色
 *   --accent N|#hex  指定强调色
 *   --mark N|#hex    指定高亮块底色
 *   --quote N|#hex   指定引用块底色
 *   --light/--dark   强制深浅方向（默认按底色的相对亮度自动判）
 *   --no-clamp       不把强调色抬到 3:1，保留配色卡原色
 *   --name X         皮肤名         默认取图片文件名
 *   --slug X         产物用的 ASCII 短名  默认 palette-<强调色色相>
 *   --summary X      写进 @theme-meta 的摘要
 *   --use X          写进 @theme-meta 的适用场景
 *
 * 输出选项:
 *   --print-only     只出候选清单就停（阶段一行为），不做角色分配、不落盘
 *   --write          落盘草稿到 assets/themes/_draft/<slug>.css
 *   --out FILE       草稿路径（配 --write，默认见上）
 *   --json           只输出 JSON
 *   --no-color       终端不出色块
 *
 * ── 为什么先出草稿而不是直接启用 ──────────────────────────
 * 落 assets/themes/_draft/ 而不是 assets/themes/，因为 templates.mjs 是
 * readdirSync().filter(endsWith('.css'))，子目录天然被忽略 —— 草稿不会混进
 * --theme 的可选清单，也不会触发 build-preview.mjs 的 README 反查告警。
 * 确认可用后一条 mv 就启用。
 *
 * ── 算法（确定性，同图同结果）──────────────────────────
 *   取色（阶段一）
 *   1. 无头浏览器 canvas 缩到 max-side（最近邻，不插值），取像素
 *      （--force-color-profile=srgb，不套色彩管理，读到的像素就是文件里的颜色）
 *   2. 每通道压到 5 bit 做桶，**同时累计桶内像素的精确通道和**（颜色走精确均值）
 *   3. k-means：**farthest-first 确定性播种**（不掷骰子），40 轮 Lloyd
 *   4. 按 CIE76 ΔE 合并相似簇 → 丢碎色 → 按占比排序
 *   派色（阶段二）
 *   5. lib/palette.mjs 把候选色派到 12 个槽位：3 个直取、9 个派生、需要时补 mark-ink
 *   k 默认给 12 是**故意给大**的：多出来的簇会被第 4 步按 ΔE 合并回去，
 *   所以「k 偏大」的代价只是慢一点；k 偏小则会把两种颜色焊死、且无法挽回。
 *   若一个簇都没合并（说明 k 被用满），结尾会提示加大 k。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, loadPlaywright, launchBrowser } from './lib/browser.mjs';
import { contrastOf, deltaE, lumOf, parseColor, rgbToHsl, swatch, toHex } from './lib/color.mjs';
import { mapPalette, renderReport, renderThemeCss } from './lib/palette.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');


/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

function parseArgs(argv) {
  const opts = {
    input: null,
    k: 12,
    maxSide: 240,
    sharp: true,
    minShare: 0.02,
    mergeE: 6,
    top: 12,
    ignoreExtremes: false,
    json: false,
    color: undefined,
    chrome: undefined,
    printOnly: false,
    // 派色
    bg: null,
    ink: null,
    accent: null,
    mark: null,
    quote: null,
    direction: 'auto',
    clamp: true,
    name: null,
    slug: null,
    summary: null,
    use: null,
    // 输出
    write: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--k') opts.k = Math.max(1, parseInt(next(), 10));
    else if (a === '--max-side') opts.maxSide = Math.max(16, parseInt(next(), 10));
    else if (a === '--min-share') opts.minShare = parseFloat(next());
    else if (a === '--merge-e') opts.mergeE = parseFloat(next());
    else if (a === '--top') opts.top = Math.max(1, parseInt(next(), 10));
    else if (a === '--ignore-extremes') opts.ignoreExtremes = true;
    else if (a === '--smooth') opts.sharp = false;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-color') opts.color = false;
    else if (a === '--chrome') opts.chrome = next();
    else if (a === '--print-only') opts.printOnly = true;
    else if (a === '--bg') opts.bg = next();
    else if (a === '--ink') opts.ink = next();
    else if (a === '--accent') opts.accent = next();
    else if (a === '--mark') opts.mark = next();
    else if (a === '--quote') opts.quote = next();
    else if (a === '--light') opts.direction = 'light';
    else if (a === '--dark') opts.direction = 'dark';
    else if (a === '--no-clamp') opts.clamp = false;
    else if (a === '--name') opts.name = next();
    else if (a === '--slug') opts.slug = next();
    else if (a === '--summary') opts.summary = next();
    else if (a === '--use') opts.use = next();
    else if (a === '--write') opts.write = true;
    else if (a === '--out') opts.out = next();
    else if (a.startsWith('--')) throw new Error(`未知选项: ${a}`);
    else if (!opts.input) opts.input = a;
    else throw new Error(`多给了个参数: ${a}`);
  }
  return opts;
}

const HELP = `用法: node scripts/palette-from-image.mjs <图片> [选项]

取色
  --k N            量化簇数              默认 12
  --max-side PX    取色前缩到的最长边      默认 240
  --min-share P    占比低于此值的当碎色丢掉  默认 0.02
  --merge-e N      色差 < N 的两个簇合并    默认 6（CIE76 ΔE）
  --top N          候选清单最多列几条      默认 12
  --ignore-extremes 丢掉接近纯黑/纯白的簇
  --smooth         缩小时启用平滑插值（默认最近邻，不插值）
  --chrome FILE    指定浏览器可执行文件

派色（不传就自动推断，推断不可信时会告警）
  --bg N|#hex      底色用第几号候选，或直接给颜色
  --ink N|#hex     字色
  --accent N|#hex  强调色
  --mark N|#hex    高亮块底色
  --quote N|#hex   引用块底色
  --light/--dark   强制深浅方向（默认按底色相对亮度自动判）
  --no-clamp       不把强调色抬到 3:1，保留配色卡原色
  --name X         皮肤名（默认取图片文件名）
  --slug X         ASCII 短名（默认 palette-<强调色色相>）
  --summary X / --use X   写进 @theme-meta

输出
  --print-only     只出候选清单就停，不做角色分配、不落盘
  --write          落草稿到 assets/themes/_draft/<slug>.css
  --out FILE       草稿路径（配 --write）
  --json           只输出 JSON
  --no-color       终端不出色块

默认：出清单 + 角色分配 + 对比度自检，**不落盘**。加 --write 才写草稿。
`;

/* ------------------------------------------------------------------ *
 * 1. 取像素（无头浏览器）
 * ------------------------------------------------------------------ */

/** 在页面里解码图片、缩放、并统计 5bit/通道 的直方图 */
const PAGE_SCRIPT = async ({ dataUrl, maxSide, sharp }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const nat = { w: img.naturalWidth, h: img.naturalHeight };
  const scale = Math.min(1, maxSide / Math.max(nat.w, nat.h));
  const w = Math.max(1, Math.round(nat.w * scale));
  const h = Math.max(1, Math.round(nat.h * scale));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // 缩放采样：**默认关掉平滑插值**（nearest）。
  // 缩小时浏览器默认会插值，在色块交界处凭空造出一圈过渡色，它们会被当成
  // 独立候选色混进清单。实测 4 色卡（#fcf9e6/#212121/#6b9bc7/#7d9fbf）：
  //   平滑 → 6 条（多出 #60778d、#98b8d0 两个假色）
  //   最近邻 → 4 条，一个不多
  // 配色卡是离散色块，最近邻只取真实像素，最干净。真想平滑用 --smooth。
  ctx.imageSmoothingEnabled = !sharp;
  // 画布本身要透明起底，否则「透明像素」会被当成黑
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // 每通道压到 5 bit 做桶（32768 个）—— 桶**只用来分簇**，
  // 同时累计每个桶里精确的通道和，颜色本身走精确均值。
  // 只用桶中心当颜色的话，量化误差最大 4/通道，实测色差能到 ΔE 3
  // （#fcf9e6 会被读成 #fcfce4）；精确均值能让纯色区域零误差还原。
  const count = new Int32Array(32768);
  const sr = new Float64Array(32768);
  const sg = new Float64Array(32768);
  const sb = new Float64Array(32768);
  let opaque = 0;
  let transparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) {
      transparent++;
      continue;
    }
    opaque++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    count[key]++;
    sr[key] += r;
    sg[key] += g;
    sb[key] += b;
  }
  // 只把非空桶传回 Node（配色卡通常几百个，照片也就几千个）
  const bins = [];
  for (let key = 0; key < 32768; key++) {
    if (count[key]) bins.push([key, count[key], sr[key], sg[key], sb[key]]);
  }
  return { nat, w, h, opaque, transparent, bins };
};

async function readPixels(inputPath, opts) {
  const ext = path.extname(inputPath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    throw new Error(`不认的图片格式 "${ext}"。支持: ${Object.keys(MIME).join(' / ')}`);
  }
  const buf = fs.readFileSync(inputPath);
  if (buf.length > 24 * 1024 * 1024) {
    throw new Error(`图片 ${(buf.length / 1048576).toFixed(1)}MB 偏大，先压到 20MB 以内更稳。`);
  }
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

  const b = await launchBrowser({ chrome: opts.chrome });
  try {
    const page = await b.browser.newPage();
    await page.goto('about:blank');
    return await page.evaluate(PAGE_SCRIPT, { dataUrl, maxSide: opts.maxSide, sharp: opts.sharp });
  } finally {
    await b.close();
  }
}

/* ------------------------------------------------------------------ *
 * 2. 量化
 * ------------------------------------------------------------------ */

/** 页面传回的紧凑桶 -> { count, rgb }；rgb 是该桶内像素的**精确均值** */
function toBins(px) {
  return px.bins.map(([, count, sr, sg, sb]) => ({
    count,
    rgb: { r: sr / count, g: sg / count, b: sb / count },
  }));
}

/**
 * 确定性播种：farthest-first。
 * 第一个中心取占比最高的桶；之后每次挑「离已有中心足够远、又足够有分量」的桶。
 * 打分 = minLab距离 × sqrt(占比) —— 纯按距离挑会选到孤立的抗锯齿噪点，
 * 纯按占比挑会把两个相邻色都选中，乘起来才是想要的折中。
 * 全程不掷骰子，所以同一张图任何时候跑都得到同一份结果。
 */
function seedCentroids(bins, k) {
  const total = bins.reduce((s, b) => s + b.count, 0);
  const cand = bins.filter((b) => b.count / total >= 0.001).sort((a, b) => b.count - a.count);
  if (!cand.length) return [];
  const centers = [cand[0].rgb];
  const dist = cand.map((c) => deltaE(c.rgb, centers[0]));
  while (centers.length < Math.min(k, cand.length)) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < cand.length; i++) {
      if (dist[i] === 0) continue;
      const score = dist[i] * Math.sqrt(cand[i].count / total);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const rgb = cand[bestIdx].rgb;
    centers.push(rgb);
    for (let i = 0; i < cand.length; i++) {
      dist[i] = Math.min(dist[i], deltaE(cand[i].rgb, rgb));
    }
  }
  return centers;
}

/**
 * k-means。**距离用 RGB 欧氏距离，不用 Lab** —— 这是有意的折中：
 *   · 配色卡是离散色块，两种度量结果几乎一样；
 *   · RGB 距离不用来回做 Lab 变换，代码短、跑得快、行为可预期。
 * 感知上的相似度交给下一步的 ΔE 合并去兜（那一步用的是 Lab）。
 * 如果以后要处理渐变/照片，这里值得升级成 Lab 空间的 k-means。
 */
function kmeans(bins, k, iterations = 40) {
  let centroids = seedCentroids(bins, k);
  let assign = new Array(bins.length).fill(0);
  if (!centroids.length) return { centroids: [], assign };
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < bins.length; i++) {
      const c = bins[i].rgb;
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const p = centroids[j];
        const d = (c.r - p.r) ** 2 + (c.g - p.g) ** 2 + (c.b - p.b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sum = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let i = 0; i < bins.length; i++) {
      const s = sum[assign[i]];
      const c = bins[i].rgb;
      s.r += c.r * bins[i].count;
      s.g += c.g * bins[i].count;
      s.b += c.b * bins[i].count;
      s.n += bins[i].count;
    }
    centroids = centroids.map((p, j) => {
      const s = sum[j];
      if (!s.n) return p; // 空簇：原地不动（保持确定性）
      return { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n };
    });
    if (!moved) break;
  }
  return { centroids, assign };
}

function quantize(px, opts) {
  const total = px.opaque;
  if (!total) throw new Error('图里没有不透明像素，取不到色。');
  const bins = toBins(px);
  const { centroids, assign } = kmeans(bins, opts.k);

  // 簇 -> 占比 + 加权平均色
  const clusters = centroids.map((c, j) => ({ j, r: 0, g: 0, b: 0, count: 0 }));
  for (let i = 0; i < bins.length; i++) {
    const cl = clusters[assign[i]];
    const c = bins[i].rgb;
    cl.count += bins[i].count;
    cl.r += c.r * bins[i].count;
    cl.g += c.g * bins[i].count;
    cl.b += c.b * bins[i].count;
  }
  let list = clusters
    .filter((c) => c.count > 0)
    .map((c) => ({
      hex: toHex({ r: c.r / c.count, g: c.g / c.count, b: c.b / c.count }),
      share: c.count / total,
    }));

  // 合并相似簇
  list.sort((a, b) => b.share - a.share);
  const merged = [];
  let mergeCount = 0;
  for (const c of list) {
    const hit = merged.find((m) => deltaE(m.hex, c.hex) < opts.mergeE);
    if (hit) {
      const w = hit.share + c.share;
      const p = parseColor(hit.hex);
      const q = parseColor(c.hex);
      hit.hex = toHex({
        r: (p.r * hit.share + q.r * c.share) / w,
        g: (p.g * hit.share + q.g * c.share) / w,
        b: (p.b * hit.share + q.b * c.share) / w,
      });
      hit.share = w;
      mergeCount++;
    } else {
      merged.push({ hex: c.hex, share: c.share });
    }
  }
  const colors = merged
    .filter((c) => c.share >= opts.minShare)
    .filter((c) => {
      if (!opts.ignoreExtremes) return true;
      const l = rgbToHsl(c.hex).l;
      return l > 0.02 && l < 0.985;
    })
    .sort((a, b) => b.share - a.share);
  // all = 阈值**之前**的全量。派色层要靠它提醒「被阈值丢掉的色里有个更像强调色的」——
  // 配色卡常把强调色做成小色块（实测一张紫卡里的粉只占 1.9%）。
  return { colors, mergeCount, clusterCount: centroids.length, all: merged };
}

/* ------------------------------------------------------------------ *
 * 3. 打印
 * ------------------------------------------------------------------ */

/** 组装候选清单（人看的行 + 机器看的 payload），不打印 */
function buildList(colors, px, opts, stat = {}) {
  const lums = colors.map((c) => lumOf(c.hex));
  const lightest = colors[lums.indexOf(Math.max(...lums))];
  const darkest = colors[lums.indexOf(Math.min(...lums))];
  const rows = colors.slice(0, opts.top).map((c, i) => {
    const hsl = rgbToHsl(c.hex);
    return {
      no: i + 1,
      hex: c.hex,
      share: Math.round(c.share * 1000) / 10,
      hslL: hsl.l,
      hslS: hsl.s,
      lum: lumOf(c.hex),
      vsLight: contrastOf(c.hex, lightest.hex),
      vsDark: contrastOf(c.hex, darkest.hex),
    };
  });
  const payload = {
    ok: true,
    source: px.nat,
    sampled: `${px.w}x${px.h}`,
    opaquePixels: px.opaque,
    transparentPixels: px.transparent,
    k: opts.k,
    clusterCount: stat.clusterCount,
    mergeCount: stat.mergeCount,
    mergeE: opts.mergeE,
    minShare: opts.minShare,
    totalColors: colors.length,
    lightest: lightest.hex,
    darkest: darkest.hex,
    // 一个簇都没合并 = k 被用满 = 图里可能还有没分开的颜色。JSON 里也带上，
    // 免得只有人看表格时才知道。
    hint:
      !stat.mergeCount && (stat.clusterCount ?? 0) >= opts.k
        ? `一个簇都没合并，k=${opts.k} 可能偏小，试试 --k ${opts.k * 2}`
        : null,
    colors: rows,
  };
  return { rows, payload, lightest, darkest };
}

function printList(rows, px, colors, opts, stat, lightest, darkest) {
  const useColor = opts.color !== false && !!swatch('#000000', 1);
  const out = [];
  out.push(`【① 候选色清单】原图 ${px.nat.w}x${px.nat.h} → 取样 ${px.w}x${px.h}  (${px.opaque} 个不透明像素)`);
  out.push('');
  out.push('  #  色块   HEX        占比     HSL-L  HSL-S  对最亮   对最暗');
  out.push('  ──  ────   ─────────  ─────  ─────  ─────  ──────  ──────');
  for (const r of rows) {
    const sw = useColor ? swatch(r.hex, 4) + '  ' : '      ';
    out.push(
      `  ${String(r.no).padStart(2)}  ${sw}#${r.hex.slice(1)}   ${String(r.share).padStart(5)}%  ` +
        `${r.hslL.toFixed(2).padStart(5)}  ${r.hslS.toFixed(2).padStart(5)}  ` +
        `${r.vsLight.toFixed(2).padStart(6)}  ${r.vsDark.toFixed(2).padStart(6)}`
    );
  }
  out.push('');
  out.push(`  最亮 = #${lightest.hex.slice(1)}   最暗 = #${darkest.hex.slice(1)}`);
  out.push(
    `  簇数 k=${opts.k} → 合并后 ${colors.length}（合并掉 ${stat.mergeCount ?? 0}；占比不足 ${opts.minShare * 100}% 的已丢）`
  );
  if (!stat.mergeCount && (stat.clusterCount ?? 0) >= opts.k) {
    out.push(`  ⚠️ 一个簇都没合并 —— 说明 k=${opts.k} 被用满了，图里可能还有没分开的颜色，试试 --k ${opts.k * 2}`);
  }
  if (colors.length > rows.length) {
    out.push(`  （另有 ${colors.length - rows.length} 条占比更小的，用 --top 或 --json 看全）`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

/** slug：ASCII 优先；中文名给不出 ASCII 就用「强调色的色相」当短名，至少保证唯一且稳定 */
function deriveSlug(opts, meta, accentHex) {
  if (opts.slug) return String(opts.slug).replace(/[^0-9a-zA-Z._-]/g, '');
  const ascii = String(meta.name).replace(/[^0-9a-zA-Z._-]/g, '');
  if (ascii) return ascii.toLowerCase();
  return `palette-${rgbToHsl(accentHex).h}`;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) {
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : 1);
  }
  const inputPath = path.resolve(opts.input);
  if (!fs.existsSync(inputPath)) throw new Error(`找不到图片: ${inputPath}`);
  if (!loadPlaywright()) throw new Error('解析不到 playwright-core，取色需要它（浏览器探测见 scripts/lib/browser.mjs）。');
  findBrowser(opts.chrome); // 早点报错，别等浏览器都起了才发现找不到

  const px = await readPixels(inputPath, opts);
  const { colors, mergeCount, clusterCount, all } = quantize(px, opts);
  if (!colors.length) throw new Error('一个候选色都没剩下，试试调小 --min-share 或 --ignore-extremes 去掉。');
  const stat = { mergeCount, clusterCount, dropped: all.length - colors.length };

  /* ── 阶段一：清单 ─────────────────────────────────────── */
  const { rows, payload, lightest, darkest } = buildList(colors, px, opts, stat);
  if (opts.json && opts.printOnly) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  if (!opts.json) printList(rows, px, colors, opts, stat, lightest, darkest);
  if (opts.printOnly) {
    if (!opts.json) {
      process.stdout.write('\n  停在这里（--print-only）。去掉它就会接着做角色分配。\n');
    } else {
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    }
    return;
  }

  /* ── 阶段二：派色 ─────────────────────────────────────── */
  const map = mapPalette(colors, {
    bg: opts.bg,
    ink: opts.ink,
    accent: opts.accent,
    mark: opts.mark,
    quote: opts.quote,
    direction: opts.direction,
    clamp: opts.clamp,
    all,
  });

  const meta = {
    name: opts.name || path.basename(inputPath).replace(/\.[^.]+$/, ''),
    slug: '',
    summary: opts.summary || `从「${path.basename(inputPath)}」取色生成的草稿`,
    use: opts.use || '待定',
  };
  const accentHex = map.slots.find((s) => s.key === 'accent').value;
  meta.slug = deriveSlug(opts, meta, accentHex);
  meta.aliases = [meta.name, meta.slug].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');

  const sourceLabel = `${path.basename(inputPath)} · ${map.direction === 'dark' ? '深色底' : '浅色底'}`;
  const date = new Date().toISOString().slice(0, 10);
  const css = renderThemeCss({ meta, map, sourceLabel, date });

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ ...payload, meta, direction: map.direction, slots: map.slots, checks: map.checks, warnings: map.warnings, ambiguity: map.ambiguity, css }, null, 2) + '\n'
    );
  } else {
    process.stdout.write(renderReport({ meta, map, sourceLabel }) + '\n');
  }

  /* ── 落盘 ─────────────────────────────────────────────── */
  const draftDir = path.join(SKILL_ROOT, 'assets', 'themes', '_draft');
  const draftPath = opts.out ? path.resolve(opts.out) : path.join(draftDir, `${meta.slug}.css`);
  if (!opts.write) {
  if (!opts.json) {
    process.stdout.write(
      `\n【④ 没落盘】默认只出报告。加 --write 就写到 assets/themes/_draft/${meta.slug}.css\n` +
        `  （_draft/ 是子目录，模板清单会自动忽略它 —— 不会混进 --theme 的可选清单，也不触发预览图自检）\n` +
        slugHint(meta, opts)
    );
  }
  return;
  }
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, css, 'utf8');
  const rel = path.relative(SKILL_ROOT, draftPath).replace(/\\/g, '/');
  if (!opts.json) {
    process.stdout.write(
      `\n【④ 草稿已落盘】${rel}\n` +
        `  启用：mv ${rel} assets/themes/${meta.slug}.css\n` +
        `  试跑：node scripts/build-cards.mjs 稿件.md --theme ${meta.slug}\n` +
        slugHint(meta, opts)
    );
  }
}

/** 皮肤名是中文时 slug 只能按色相兜底，说一声，免得看到 palette-138 一脸问号 */
function slugHint(meta, opts) {
  if (opts.slug || /[0-9a-zA-Z]/.test(meta.name)) return '';
  return (
    `  提示：皮肤名「${meta.name}」里没有 ASCII，@slug 只能用强调色色相兜底（${meta.slug}）。\n` +
    `        产物文件名想更好认，加一个 --slug 就行。\n`
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
