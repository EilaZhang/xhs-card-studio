#!/usr/bin/env node
/**
 * [INPUT]: Markdown 稿件（文件或 --text 传入）+ assets/base.css + assets/themes/<皮肤>.css + assets/frames/<边框>.css
 * [OUTPUT]: <out>/cards.html（预览确认用，含溢出警告）、<out>/slides/pNN.html（逐张出图用）、<out>/plan.json（分页方案）
 * [POS]: 生成层。负责 稿件 -> 分页 -> 卡片 HTML，不负责截图
 * [PROTOCOL]: 变更时更新此头部
 *
 * 用法:
 *   node scripts/build-cards.mjs 稿件.md [选项]
 *
 * 选项:
 *   --out DIR        输出目录     默认: <稿件同级>/xhs-cards
 *   --theme NAME     皮肤名       默认: 奶油蓝（assets/themes/default.css）
 *                                 别名 知识风 / knowledge 可切到白底红强调那套
 *   --frame NAME     配图边框     默认: hairline（可选 hairline / paper / none）
 *   --max-chars N    每页目标字数 默认: 按卡片实际可用高度自动算（不是固定 260）
 *   --title T        覆盖标题（命令行 > front-matter）
 *   --text "..."     直接传稿件文本，不读文件
 *   --no-slides      不生成单页文件，只出 cards.html
 *
 * 优先级: 命令行 > 稿件 front-matter > 内置默认值
 *
 * 分页规则（双轨）:
 *   1. 单独一行的 --- 或 <!-- page -->  -> 强制分页
 *   2. 单独一行的纯数字，全篇出现 ≥2 次  -> 强制分页（只 1 次怕误伤正文）
 *   3. # 一级标题                        -> 另起一页
 *   4. 都没有就按每页容量在段落边界自动分页
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTemplates } from './lib/templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

/** 视觉模板清单（皮肤 + 配图边框）。身份都写在各自的 css 文件头部，见 lib/templates.mjs。 */
const TPL = loadTemplates(SKILL_ROOT);

/* 皮肤与配图边框的身份（显示名 / 别名 / 摘要 / 适用场景）全部写在各自的 css
   文件头部，由 scripts/lib/templates.mjs 统一读取（命令行报错清单、总览页都读它），
   这里不再维护第二份别名表。
   2026-09-17 整理视觉模板时定的规矩：新增一套模板 = 新增一个 css 文件，代码零改动。 */

/** 默认皮肤名（对应 assets/themes/<名>.css）。2026-09-15 由用户确认改为奶油蓝。 */
const DEFAULT_THEME = 'default';

/**
 * 默认配图边框预设（对应 assets/frames/<名>.css）。
 * 边框层的唯一入口：不传 --frame 时也显式加载一个预设。
 * （重构前皮肤文件里内联了一份和 hairline 一模一样的默认值，
 *   等于这个预设是空转的 —— 改它不生效，见 assets/frames/hairline.css 注释。）
 */
const DEFAULT_FRAME = 'hairline';

/* ================================================================== *
 * 工具
 * ================================================================== */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 按**显示宽度**补齐空格（全角字符算 2 列）。
 * 直接用 String.padEnd 是按「字符个数」补的，中英混排的清单会歪一大截。
 */
const padDisplay = (s, width) => {
  const FULL = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
  const w = [...String(s)].reduce((acc, ch) => acc + (FULL.test(ch) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(1, width - w));
};

/** 去掉空白后的字符数，用于估算排版占位 */
const countChars = (s) => String(s).replace(/\s/g, '').length;

/** 从起始目录逐级向上找同名文件（模拟 Obsidian 的全库索引行为） */
function findUpwards(name, fromDir, maxLevels = 6) {
  let dir = path.resolve(fromDir);
  for (let n = 0; n <= maxLevels; n += 1) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 把稿件里的相对图片路径解析成绝对 file:// 地址 */
function resolveAsset(src, baseDir) {
  if (/^(https?:|data:|file:)/i.test(src)) return src;
  const clean = decodeURIComponent(String(src).trim());
  const direct = path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);
  if (fs.existsSync(direct)) return pathToFileURL(direct).href;

  // Obsidian 习惯：附件常放在 Vault 根或某个全局附件目录，稿件里只写文件名。
  // 直接找不到时，先按相对路径向上找，再退而只按文件名向上找。
  const up = findUpwards(clean, baseDir) || findUpwards(path.basename(clean), baseDir);
  if (up) return pathToFileURL(up).href;

  process.stderr.write(`[warn] 找不到图片，将留空占位: ${clean}（已从 ${baseDir} 逐级向上搜索）\n`);
  return 'about:blank#missing';
}

/* ------------------------------------------------------------------ *
 * Obsidian 嵌入语法 ![[文件]] / ![[文件|300]] / ![[文件|说明]]
 * ------------------------------------------------------------------ */

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

/** 解析一条 Obsidian 嵌入；非图片扩展名返回 null（由调用方决定怎么提示） */
function parseWikiEmbed(raw) {
  const m = String(raw).match(/^!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]$/);
  if (!m) return null;
  const file = m[1].trim();
  if (!IMG_EXT.test(file)) return null;
  const suffix = (m[2] || '').trim();
  // |300 或 |300x200 是尺寸(取宽)，其余当图注
  const size = suffix.match(/^(\d+)(?:\s*[x×]\s*\d+)?$/);
  return size ? { src: file, alt: '', width: Number(size[1]) } : { src: file, alt: suffix, width: null };
}

/**
 * 段落里混着图片时拆成「文字 + 独立图片块」。
 * 必须拆：图片按块计排版权重，留在段落里会被当 0 权重，导致一页塞进多张图而溢出。
 */
const INLINE_IMG = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/g;

function splitTextAndImages(text) {
  const out = [];
  let last = 0;
  INLINE_IMG.lastIndex = 0;
  let m = INLINE_IMG.exec(text);
  while (m) {
    const before = text.slice(last, m.index).trim();
    if (before) out.push({ type: 'paragraph', text: before });
    const wiki = parseWikiEmbed(m[0]);
    if (wiki) {
      out.push({ type: 'image', alt: wiki.alt, src: wiki.src, width: wiki.width });
    } else {
      const std = m[0].match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
      if (std) out.push({ type: 'image', alt: std[1], src: std[2] });
    }
    last = m.index + m[0].length;
    m = INLINE_IMG.exec(text);
  }
  const tail = text.slice(last).trim();
  if (tail) out.push({ type: 'paragraph', text: tail });
  return out.length ? out : [{ type: 'paragraph', text }];
}

/* ------------------------------------------------------------------ *
 * 图片尺寸探测
 * 分页必须按图片「渲染后的高度」算权重。写死一个常数会让每张图都被
 * 推到单独一页，把图文拆散——真实稿件上这个问题非常明显。
 * ------------------------------------------------------------------ */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** JPEG 要扫段，SOFn 里存着宽高 */
function readJpegSize(file) {
  try {
    const buf = fs.readFileSync(file);
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      // 无长度字段的标记，跳过
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15，排除 DHT/JPG/DAC
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/** 只读文件头拿像素尺寸，不加载整图 */
function readImageSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    fs.closeSync(fd);

    if (head.slice(0, 8).equals(PNG_SIG)) {
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    }
    if (head.slice(0, 4).toString('latin1') === 'GIF8') {
      return { w: head.readUInt16LE(6), h: head.readUInt16LE(8) };
    }
    if (head[0] === 0xff && head[1] === 0xd8) return readJpegSize(file);
    if (head.slice(0, 4).toString('latin1') === 'RIFF' && head.slice(8, 12).toString('latin1') === 'WEBP') {
      const fmt = head.slice(12, 16).toString('latin1');
      if (fmt === 'VP8X') {
        return { w: head.readUIntLE(24, 3) + 1, h: head.readUIntLE(27, 3) + 1 };
      }
      if (fmt === 'VP8 ') {
        return { w: head.readUInt16LE(26) & 0x3fff, h: head.readUInt16LE(28) & 0x3fff };
      }
      if (fmt === 'VP8L') {
        const b = head.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 取 CSS 里的 px / 纯数字变量 */
/**
 * 去掉 CSS 注释。
 *
 * 变量必须只从**真正生效的声明**里读。注释里难免出现带值的示例，比如
 * 皮肤注释里教用户「想改字号就写 `--body-size: 44px;`」—— 这种文本
 * 绝不能被当成声明。实测踩过：就是因为没剥注释，那句示例把
 * `--body-size` 从 40px 读成了 44px，分页容量跟着从 345 掉到 285，
 * 而页面上完全看不出来，只是内容提前换页。
 */
const stripCssComments = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 从拼接后的 CSS（base → theme → frame）里取某个变量的**最后一个**匹配。
 *
 * 为什么必须取最后一个：三层都用 :root / 同名选择器，级联规则是**后写的赢**。
 * 早期实现用的是 String.match（只返回第一个匹配），之所以一直没出问题，
 * 是因为当时每个变量恰好只在一个文件里定义。2026-09-17 把「所有皮肤共用的
 * 基准值」收进 base.css 之后，第一个匹配就变成了被覆盖掉的旧值 ——
 * 后果很阴险：**渲染用 theme 的值、分页却按 base 的值算**，
 * 页面上不报错，只是内容悄悄溢出或提前换页。
 */
const readVarLast = (css, pattern) => {
  const clean = stripCssComments(css);   // 只剥一次，循环里复用（每次重建字符串会让 lastIndex 错乱）
  const re = new RegExp(pattern.source, 'g');
  let m;
  let last = null;
  while ((m = re.exec(clean)) !== null) last = m;
  return last;
};

const readPxVar = (css, name, fallback) => {
  const m = readVarLast(css, new RegExp(`--${name}\\s*:\\s*([\\d.]+)px`));
  return m ? Number(m[1]) : fallback;
};
const readNumVar = (css, name, fallback) => {
  const m = readVarLast(css, new RegExp(`--${name}\\s*:\\s*([\\d.]+)\\s*;`));
  return m ? Number(m[1]) : fallback;
};

/**
 * 给图片块补上「折算成多少个字」的当量，供分页使用。
 * 渲染高度 = min(原高 × 渲染宽 / 原宽, --img-max-h) + 上下边框
 * 1 个中文字占的高度 ≈ bodySize² × leading / 内容宽
 */
function annotateImageSizes(blocks, baseDir, themeCss) {
  const cardW = readPxVar(themeCss, 'card-w', 1080);
  const padX = readPxVar(themeCss, 'pad-x', 96);
  const contentW = Math.max(200, cardW - padX * 2);
  const imgMaxH = readPxVar(themeCss, 'img-max-h', 720);
  const bodySize = readPxVar(themeCss, 'body-size', 40);
  const leading = readNumVar(themeCss, 'body-leading', 1.78);
  const gapBlock = readPxVar(themeCss, 'gap-block', 36);
  // border-box 下边框占实际宽高，粗边框（相纸框那种）不能忽略
  const bw2 = readPxVar(themeCss, 'img-border-w', 0) * 2;

  const pxPerChar = (bodySize * bodySize * leading) / contentW;

  for (const b of blocks) {
    if (b.type !== 'image') continue;
    const resolved = resolveAsset(b.src, baseDir);
    if (!resolved.startsWith('file:')) continue;
    const size = readImageSize(fileURLToPath(resolved));
    if (!size || !size.w) continue;

    // 先按容器宽自适应，再受高度上限回缩。回缩时宽度必须跟着缩，
    // 否则估出来的占地偏大，会把本该同页的图错误推到下一页。
    let renderW = b.width ? Math.min(b.width, contentW) : contentW;
    let contentH = (size.h * Math.max(40, renderW - bw2)) / size.w;
    let totalH = contentH + bw2;
    if (totalH > imgMaxH) {
      const innerH = Math.max(20, imgMaxH - bw2);
      contentH = innerH;
      totalH = innerH + bw2;
      renderW = (size.w * innerH) / size.h + bw2;
    }
    b.pxW = Math.round(renderW);
    b.pxH = Math.round(totalH);
    b.estChars = Math.round((totalH + gapBlock) / pxPerChar);
  }

  // 一页真实能装多少：卡片高 − 上下内边距 − 标题区 − 标题与正文间距。
  // 只按字数估会严重低估：图多字少的稿子会被切得七零八落，
  // 白白浪费卡片下半部分的空白（实测 260 字只花掉 832px，可用有 1108px）。
  const cardH = readPxVar(themeCss, 'card-h', 1440);
  const padY = readPxVar(themeCss, 'pad-y', 104);
  const titleSize = readPxVar(themeCss, 'title-size', 62);
  const gapHead = readPxVar(themeCss, 'gap-head', 44);
  const availH = Math.max(200, cardH - padY * 2 - titleSize * 1.3 - gapHead);

  return { pxPerChar, availH };
}

/* ================================================================== *
 * 1. 稿件解析
 * ================================================================== */

function parseFrontMatter(md) {
  const m = md.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: md.slice(m[0].length) };
}

const BLOCK_START = /^(#{1,6}\s|>\s?|\s*([-*+]|\d+[.)])\s+|!\[|```)/;

function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  // 裸数字独立成行 = 作者手写的页码分页（Obsidian 笔记里常见）。
  // 必须出现 2 次以上才认，否则正文里孤零零一个数字也会被当分页符。
  const numLineIdx = [];
  lines.forEach((ln, idx) => {
    if (/^\d{1,2}$/.test(ln.trim())) numLineIdx.push(idx);
  });
  const pageNums = new Set(numLineIdx.length >= 2 ? numLineIdx : []);

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) {
      i += 1;
      continue;
    }
    if (pageNums.has(i)) {
      blocks.push({ type: 'break' });
      i += 1;
      continue;
    }
    if (/^<!--\s*page\s*-->$/i.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      blocks.push({ type: 'break' });
      i += 1;
      continue;
    }
    if (/^```/.test(t)) {
      // 代码块当普通段落处理，避免吃字
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'paragraph', text: buf.join('\n') });
      continue;
    }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }

    const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (img) {
      blocks.push({ type: 'image', alt: img[1], src: img[2] });
      i += 1;
      continue;
    }

    // Obsidian 嵌入：![[图.png]] / ![[图.png|300]]，非图片扩展名直接跳过
    if (/^!\[\[[^\]]+\]\]$/.test(t)) {
      const wiki = parseWikiEmbed(t);
      if (wiki) {
        blocks.push({ type: 'image', alt: wiki.alt, src: wiki.src, width: wiki.width });
      } else {
        // 非图片嵌入：这里静默丢弃，由 main() 统一汇总提示（含文件名清单 + plan.json）。
        // 不要在这里单独打日志，否则同一篇稿子会刷出一堆重复警告。
        void 0;
      }
      i += 1;
      continue;
    }

    if (/^>\s?/.test(t)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'quote', text: buf.join('\n') });
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(raw)) {
      const ordered = /^\s*\d+[.)]\s+/.test(raw);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const buf = [t];
    i += 1;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i += 1;
    }
    blocks.push(...splitTextAndImages(buf.join(' ')));
  }

  return blocks;
}

/* ================================================================== *
 * 2. 分页
 * ================================================================== */

function blockChars(b) {
  switch (b.type) {
    case 'heading':
      return countChars(b.text) * 1.6; // 标题字号大，占位加权
    case 'paragraph':
    case 'quote':
      return countChars(b.text);
    case 'list':
      return b.items.reduce((n, it) => n + countChars(it), 0) + b.items.length * 6;
    case 'image':
      // annotateImageSizes 会按图片真实尺寸折算；拿不到尺寸才退回保守值
      return b.estChars ?? 380;
    default:
      return 0;
  }
}

function pageChars(blocks) {
  return blocks.reduce((n, b) => n + blockChars(b), 0);
}

/** 超长段落按句号拆开，避免单段撑爆一整页 */
function splitLongParagraph(text, limit) {
  if (countChars(text) <= limit * 1.5) return [text];
  const parts = text
    .split(/(?<=[。！？；!?;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && countChars(cur) + countChars(p) > limit) {
      out.push(cur);
      cur = p;
    } else {
      cur += p;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

function paginate(blocks, maxChars) {
  const expanded = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      splitLongParagraph(b.text, maxChars).forEach((t) => expanded.push({ type: 'paragraph', text: t }));
    } else {
      expanded.push(b);
    }
  }

  const pages = [];
  let cur = [];
  const flush = () => {
    if (cur.length) {
      pages.push(cur);
      cur = [];
    }
  };

  let i = 0;
  while (i < expanded.length) {
    const b = expanded[i];

    // 强制分页
    if (b.type === 'break') {
      flush();
      i += 1;
      continue;
    }

    // H1 = 封面页：只收标题 + 紧随的一句副标题，然后立刻封页
    if (b.type === 'heading' && b.level === 1) {
      flush();
      cur.push(b);
      const nx = expanded[i + 1];
      if (nx && (nx.type === 'quote' || (nx.type === 'paragraph' && countChars(nx.text) <= 48))) {
        cur.push(nx);
        i += 1;
      }
      flush();
      i += 1;
      continue;
    }

    // H2 = 一节 = 一张卡
    if (b.type === 'heading' && b.level === 2) {
      flush();
      cur.push(b);
      i += 1;
      continue;
    }

    // H3 及以下作为页内小标题，不单独开页；标题孤行时不许被切走
    const onlyHeading = cur.length > 0 && cur.every((x) => x.type === 'heading');
    if (cur.length && !onlyHeading && pageChars(cur) + blockChars(b) > maxChars) {
      // 配图放不下时，把紧挨在它前面的那段说明文字一起带到下一页。
      // 否则会出现「文字留在上页结尾、配图孤零零出现在下页开头」的割裂——
      // 稿子里 "说明文字 + ![](图)" 本来就是连在一起读的。
      if (b.type === 'image' && cur.length > 1 && cur[cur.length - 1].type === 'paragraph') {
        const tail = cur.pop();
        flush();
        cur.push(tail);
      } else {
        flush();
      }
    }
    cur.push(b);
    i += 1;
  }
  flush();

  return mergeOrphanFigures(mergeTinyPages(pages, maxChars), maxChars);
}

/** 只有“光秃秃的标题页”（标题下面几乎没字）才被相邻页吸收，避免出现空卡 */
function mergeTinyPages(pages, maxChars) {
  const out = [];
  for (const page of pages) {
    const prev = out[out.length - 1];
    const bodyChars = page
      .filter((b) => b.type !== 'heading')
      .reduce((n, b) => n + blockChars(b), 0);
    const isShell = bodyChars < 34;
    const prevIsCover = prev && prev[0] && prev[0].type === 'heading' && prev[0].level === 1;
    if (prev && isShell && !prevIsCover && pageChars(prev) + pageChars(page) <= maxChars) {
      out[out.length - 1] = prev.concat(page);
    } else {
      out.push(page);
    }
  }
  return out.length ? out : [[{ type: 'paragraph', text: '' }]];
}

/**
 * 一张图独自占满一页时四周全是空白，很难看。优先把它塞进相邻页：
 * 先试前一页（说明文字和配图通常连着，合起来才读得通），再试后一页。
 * 两边都放不下才让它独立成页。整篇只有一张图的稿子不受影响——没有邻页可并。
 */
function mergeOrphanFigures(pages, maxChars) {
  const out = [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const orphan = page.length === 1 && page[0].type === 'image';
    if (!orphan) {
      out.push(page);
      continue;
    }
    const prev = out[out.length - 1];
    const prevIsCover = prev && prev[0] && prev[0].type === 'heading' && prev[0].level === 1;
    if (prev && !prevIsCover && pageChars(prev) + pageChars(page) <= maxChars) {
      out[out.length - 1] = prev.concat(page);
      continue;
    }
    const next = pages[i + 1];
    if (next && pageChars(page) + pageChars(next) <= maxChars) {
      out.push(page.concat(next));
      i += 1; // 后一页已经被并进来，别再单独处理
      continue;
    }
    out.push(page);
  }
  return out.length ? out : [[{ type: 'paragraph', text: '' }]];
}

/* ================================================================== *
 * 3. 卡片类型
 * ================================================================== */

function classify(blocks, index) {
  const nonHeading = blocks.filter((b) => b.type !== 'heading');
  const first = blocks[0];

  if (index === 0 && first && first.type === 'heading' && first.level === 1) return 'cover';

  if (nonHeading.length === 1) {
    const only = nonHeading[0];
    if (only.type === 'quote') return 'quote';
    if (only.type === 'paragraph' && countChars(only.text) <= 56 && blocks.length <= 2) return 'quote';
  }
  if (blocks.length === 1 && blocks[0].type === 'quote') return 'quote';
  return 'content';
}

/* ================================================================== *
 * 4. 行内渲染
 * ================================================================== */

function inline(text, baseDir) {
  const tokens = [];
  let s = String(text);

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, src) => {
    tokens.push(`<img src="${esc(resolveAsset(src, baseDir))}" alt="${esc(alt)}">`);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, href) => {
    tokens.push(`<a href="${esc(href)}">${esc(txt)}</a>`);
    return `\u0000${tokens.length - 1}\u0000`;
  });

  // Obsidian 行内嵌入 ![[图.png|300]]
  s = s.replace(/!\[\[[^\]]+\]\]/g, (m0) => {
    const e = parseWikiEmbed(m0);
    if (!e) return '';
    const style = e.width ? ` style="width:${e.width}px"` : '';
    tokens.push(`<img src="${esc(resolveAsset(e.src, baseDir))}" alt="${esc(e.alt)}"${style}>`);
    return `\u0000${tokens.length - 1}\u0000`;
  });

  s = esc(s);

  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<![_\w])_([^_\n]+)_(?!_)/g, '<em>$1</em>');

  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => tokens[Number(n)]);
  return s;
}

function renderBlock(b, baseDir) {
  switch (b.type) {
    case 'heading': {
      const tag = b.level <= 2 ? 'h3' : 'h4';
      return `<${tag}>${inline(b.text, baseDir)}</${tag}>`;
    }
    case 'paragraph':
      return `<p>${inline(b.text, baseDir)}</p>`;
    case 'quote':
      return `<blockquote>${b.text
        .split('\n')
        .filter(Boolean)
        .map((l) => `<p>${inline(l, baseDir)}</p>`)
        .join('')}</blockquote>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((it) => `<li>${inline(it, baseDir)}</li>`).join('')}</${tag}>`;
    }
    case 'image':
      return `<figure><img src="${esc(resolveAsset(b.src, baseDir))}" alt="${esc(b.alt)}"${
        b.width ? ` style="width:${b.width}px"` : ''
      }>${b.alt ? `<figcaption>${esc(b.alt)}</figcaption>` : ''}</figure>`;
    default:
      return '';
  }
}

/* ================================================================== *
 * 5. 页面组装
 * ================================================================== */

function buildPageHtml(blocks, type, baseDir, meta, extraClass = '') {
  const rest = [...blocks];
  let titleHtml = '';
  let kickerHtml = '';

  if (type === 'cover') {
    const h1 = rest.shift();
    if (meta.kicker) kickerHtml = `<span class="card__kicker">${esc(meta.kicker)}</span>`;
    titleHtml = `<h1 class="card__title">${inline(h1.text, baseDir)}</h1>`;
  } else {
    const hi = rest.findIndex((b) => b.type === 'heading');
    if (hi > -1) {
      const h = rest.splice(hi, 1)[0];
      titleHtml = `<h2 class="card__title">${inline(h.text, baseDir)}</h2>`;
    }
  }

  const contentHtml = rest.map((b) => renderBlock(b, baseDir)).join('\n');

  // 页码由调用方通过 meta.pageNo / meta.pageTotal 传入，这里直接写死真实数字。
  // 早期版本这里硬编码了 {PAGE}/{TOTAL} 占位符，但生成 slides/*.html 时没有任何地方替换它，
  // 导致开启 footer 后渲染出的 PNG 底部长出字面 "{PAGE}/{TOTAL}"。已修正。
  const pageLabel = meta.pageNo && meta.pageTotal ? `${meta.pageNo}/${meta.pageTotal}` : '';
  const foot =
    meta.footer
      ? `<div class="card__foot"><span>${esc(meta.footer)}</span><span>${pageLabel}</span></div>`
      : '';

  const head = titleHtml || kickerHtml ? `<div class="card__head">${kickerHtml}${titleHtml}</div>` : '';

  return `<section class="card card--${type}${extraClass}">
  ${head}
  <div class="card__body">
    <div class="card__content">
${contentHtml}
    </div>
  </div>
  ${foot}
</section>`;
}

function docHtml({ cards, themeCss, title, single }) {
  const detect = single
    ? ''
    : `
<script>
(function () {
  function check() {
    document.querySelectorAll('.card').forEach(function (c, i) {
      var over = c.scrollHeight - c.clientHeight;
      if (over > 2) {
        var flag = document.createElement('div');
        flag.textContent = '溢出 ' + over + 'px · 第 ' + (i + 1) + ' 张';
        flag.style.cssText = 'position:absolute;top:0;right:0;z-index:99;background:#e5484d;color:#fff;font:600 20px/1.5 system-ui;padding:8px 16px;border-radius:0 0 0 12px';
        c.appendChild(flag);
        c.style.outline = '6px solid #e5484d';
      }
    });
  }
  if (document.readyState === 'complete') check();
  else window.addEventListener('load', check);
})();
</script>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title || '小红书卡片')}</title>
<style>
${themeCss}
</style>
</head>
<body class="${single ? 'is-single' : ''}">
<div class="deck">
${cards}
</div>${detect}
</body>
</html>`;
}

/* ================================================================== *
 * 6. 入口
 * ================================================================== */

function parseArgs(argv) {
  const o = { input: null, out: null, theme: null, frame: null, maxChars: null, title: null, text: null, slides: true };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--theme') o.theme = next();
    else if (a === '--frame') o.frame = next();
    else if (a === '--max-chars') o.maxChars = parseInt(next(), 10);
    else if (a === '--title') o.title = next();
    else if (a === '--text') o.text = next();
    else if (a === '--no-slides') o.slides = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  o.input = rest[0] || null;
  return o;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.input && !opts.text)) {
    console.log(
      '用法: node scripts/build-cards.mjs 稿件.md [--out DIR] [--theme 皮肤] [--frame 边框] [--max-chars N] [--title 标题]\n' +
        '      --theme 皮肤（默认 奶油蓝）:\n' +
        '              奶油蓝 / default      奶油黄底 + 淡蓝点缀（当前默认）\n' +
        '              知识风 / knowledge    白底 + 红强调，原「干净知识风」\n' +
        '              暗夜   / dark         深炭蓝底 + 琥珀强调（深色底）\n' +
        '              苔绿   / sage         浅鼠尾草底 + 苔绿强调\n' +
        '              也可指向 assets/themes/ 下自建的 <名字>.css\n' +
        '      --frame 配图边框风格（也可写中文）:\n' +
        '              hairline / 细描边   一条细线框住配图（默认）\n' +
        '              paper    / 相纸框     粗边填卡片底色+投影，像照片贴在相纸上\n' +
        '              none     / 无边框     配图光边贴着版面\n' +
        '      --max-chars 不写时按卡片实际可用高度自动计算，指定数字可强制干预分页密度\n' +
        '      node scripts/build-cards.mjs --text "稿件正文" [--out DIR]'
    );
    process.exit(opts.help ? 0 : 2);
  }

  const sourcePath = opts.input ? path.resolve(opts.input) : null;
  if (sourcePath && !fs.existsSync(sourcePath)) {
    console.error(`稿件不存在: ${sourcePath}`);
    process.exit(2);
  }

  const raw = opts.text != null ? opts.text : fs.readFileSync(sourcePath, 'utf8');
  const baseDir = sourcePath ? path.dirname(sourcePath) : process.cwd();

  const { meta, body } = parseFrontMatter(raw);
  if (opts.title) meta.title = opts.title;

  // 皮肤优先级：命令行 --theme > 稿件 front-matter theme > DEFAULT_THEME
  // 注意：原实现把 opts.theme 默认值设成 'default'，于是「没传 --theme」和
  // 「显式传 --theme default」不可区分，front-matter 里写了 theme 时命令行
  // 无法强制切回默认皮肤。改成 null 哨兵值后三条路径都可覆盖。
  const themeArg = String(opts.theme ?? meta.theme ?? DEFAULT_THEME).trim();
  let themeName = TPL.themeAliases.get(themeArg.toLowerCase()) || null;
  if (!themeName) {
    // 别名没命中，再看是不是用户自建的皮肤文件（theming.md 教的做法）
    const probe = path.join(SKILL_ROOT, 'assets', 'themes', `${themeArg}.css`);
    if (fs.existsSync(probe)) themeName = themeArg;
  }
  if (!themeName) {
    // 列可用皮肤时带上摘要，别让用户对着一堆文件名猜哪套是哪套。
    // （2026-09-17 之前这里有个「深色」的特判报错 —— 当时确实没有深色皮肤，
    //   而旧文档把白底的知识风误叫「深色风」。现在有了真正的深色皮肤「暗夜」，
    //   深色/暗色/dark 都直接指向它，那段解释性报错就不需要了。）
    const available = TPL.themes.map(
      (t) => `  ${padDisplay(t.key, 10)}${TPL.themeLabel(t.key)}${t.summary ? `  —— ${t.summary}` : ''}`
    );
    console.error(
      `认不出皮肤「${themeArg}」。当前可用：\n${available.join('\n')}\n` +
        `别名：${TPL.themes.flatMap((t) => t.aliases).join(' / ')}\n` +
        `（也可以自己新建 assets/themes/<名字>.css，在文件头部写好 @theme-meta，再用 --theme <名字>）`
    );
    process.exit(2);
  }
  const themeLabel = TPL.themeLabel(themeName);

  const themePath = path.join(SKILL_ROOT, 'assets', 'themes', `${themeName}.css`);
  if (!fs.existsSync(themePath)) {
    console.error(`找不到皮肤文件: ${themePath}`);
    process.exit(2);
  }

  // Obsidian 嵌入里的非图片文件（.html / .pdf / 其他笔记）：卡片吃不下，被忽略。
  // 用户 2026-09-15 决定「直接忽略」，但**不能静默**——之前是悄悄吞掉，
  // 用户以为第 3 页少了东西是 bug。这里出声说明，并写进 plan.json。
  const skippedEmbeds = [];
  for (const m of body.matchAll(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g)) {
    const file = m[1].trim();
    if (!IMG_EXT.test(file) && !skippedEmbeds.includes(file)) skippedEmbeds.push(file);
  }
  if (skippedEmbeds.length) {
    console.warn(
      `[ignore] 稿件里有 ${skippedEmbeds.length} 个非图片嵌入，卡片只支持图片，已跳过：\n` +
        skippedEmbeds.map((f) => `         - ${f}`).join('\n') +
        '\n         想让它出现，就先转成 PNG/JPG 再引用。'
    );
  }
  // 配图边框风格：--frame > 稿件 front-matter frame > DEFAULT_FRAME
  // 边框由 assets/frames/ 独占定义（皮肤文件不再内联 --img-border-*），
  // 所以这里**始终**要加载一个预设，默认 hairline。
  const explicitFrame = opts.frame || meta.frame || null;
  const frameRaw = String(explicitFrame || DEFAULT_FRAME).trim();
  const frameKey = TPL.frameAliases.get(frameRaw.toLowerCase());
  if (!frameKey) {
    console.error(
      `认不出边框风格「${frameRaw}」。可用值：\n` +
        TPL.frames.map((f) => `  ${padDisplay(f.key, 10)}${f.summary || f.name}`).join('\n') +
        `\n别名：${TPL.frames.flatMap((f) => f.aliases).join(' / ')}`
    );
    process.exit(2);
  }
  const framePath = path.join(SKILL_ROOT, 'assets', 'frames', `${frameKey}.css`);
  if (!fs.existsSync(framePath)) {
    console.error(`找不到边框预设文件: ${framePath}`);
    process.exit(2);
  }
  const frameCss = fs.readFileSync(framePath, 'utf8');
  // 没显式指定时标上「（默认）」，免得用户以为参数没生效
  const frameLabel = explicitFrame ? frameKey : `${frameKey}（默认）`;

  const themeCss = [
    fs.readFileSync(path.join(SKILL_ROOT, 'assets', 'base.css'), 'utf8'),
    fs.readFileSync(themePath, 'utf8'),
    frameCss,
  ].filter(Boolean).join('\n\n');

  const blocks = parseBlocks(body);
  const metrics = annotateImageSizes(blocks, baseDir, themeCss);
  // 每页容量优先级：命令行 --max-chars > 稿件 front-matter maxChars > 自动算
  const autoMaxChars = Math.max(120, Math.round(metrics.availH / metrics.pxPerChar));
  const maxChars = opts.maxChars || (meta.maxChars ? parseInt(meta.maxChars, 10) : autoMaxChars);
  const pages = paginate(blocks, maxChars);

  const title = meta.title || (blocks.find((b) => b.type === 'heading' && b.level === 1) || {}).text || '小红书卡片';

  const outDir = path.resolve(
    opts.out || (sourcePath ? path.join(baseDir, 'xhs-cards') : path.join(SKILL_ROOT, 'outputs', `run-${Date.now()}`))
  );
  fs.mkdirSync(outDir, { recursive: true });

  const plan = [];
  const slides = [];

  pages.forEach((pageBlocks, idx) => {
    const type = classify(pageBlocks, idx);
    const pageMeta = { ...meta, pageNo: idx + 1, pageTotal: pages.length };
    if (pageMeta.footer) {
      pageMeta.footer = pageMeta.footer.replace('{PAGE}', String(idx + 1)).replace('{TOTAL}', String(pages.length));
    }
    // 内容不满的页自动垂直居中，避免正文吊在顶部、下半张全空
    const bodyChars = pageBlocks
      .filter((b) => b.type !== 'heading')
      .reduce((n, b) => n + blockChars(b), 0);
    const airy = type === 'content' && bodyChars < maxChars * 0.72 ? ' card--airy' : '';

    // 整页只有一张图：放开图片高度限制，避免半张卡是空白
    const bodies = pageBlocks.filter((b) => b.type !== 'heading');
    const soloFigure = bodies.length === 1 && bodies[0].type === 'image' ? ' card--figure' : '';

    const html = buildPageHtml(pageBlocks, type, baseDir, pageMeta, airy + soloFigure);

    const warn = [];
    if (type !== 'cover' && !pageBlocks.some((b) => b.type === 'heading')) warn.push('本页无标题');
    if (pageChars(pageBlocks) > maxChars * 1.3) warn.push('内容偏多，可能溢出');

    plan.push({
      index: idx + 1,
      type,
      chars: Math.round(pageChars(pageBlocks)),
      blocks: pageBlocks.map((b) => b.type),
      warning: warn,
    });
    slides.push(html);
  });

  const cardsHtml = docHtml({ cards: slides.join('\n'), themeCss, title, single: false });
  const cardsPath = path.join(outDir, 'cards.html');
  fs.writeFileSync(cardsPath, cardsHtml, 'utf8');

  const slidePaths = [];
  if (opts.slides) {
    const dir = path.join(outDir, 'slides');
    fs.mkdirSync(dir, { recursive: true });
    // 清掉上一轮的残留单页：改了稿子导致页数变少时，旧页会留在目录里，
    // 万一渲染降级到 chrome-cli（要求传 slides 目录）就会把废弃页一起出图。
    for (const f of fs.readdirSync(dir)) {
      if (/^p\d+\.html$/.test(f)) fs.unlinkSync(path.join(dir, f));
    }
    slides.forEach((html, i) => {
      const p = path.join(dir, `p${String(i + 1).padStart(2, '0')}.html`);
      fs.writeFileSync(p, docHtml({ cards: html, themeCss, title, single: true }), 'utf8');
      slidePaths.push(p);
    });
  }

  const planPath = path.join(outDir, 'plan.json');
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      { ok: true, title, theme: themeLabel, themeKey: themeName, frame: frameLabel, frameKey, maxChars, count: pages.length, outDir, preview: cardsPath, plan },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        title,
        theme: themeLabel,
        themeKey: themeName,
        frame: frameLabel,
        frameKey,
        maxChars,
        auto: !(opts.maxChars || meta.maxChars),
        count: pages.length,
        outDir,
        preview: cardsPath,
        slidesDir: opts.slides ? path.join(outDir, 'slides') : null,
        skippedEmbeds: skippedEmbeds.length ? skippedEmbeds : undefined,
        plan,
      },
      null,
      2
    )
  );
}

main();
