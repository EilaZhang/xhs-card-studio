#!/usr/bin/env node
/**
 * [INPUT]: 候选色清单 [{hex, share}] + 可选的角色指认（bg / ink / accent / mark / quote）
 * [OUTPUT]: 9 个槽位的值（+ 条件槽位 mark-ink）+ 每个值的来源 + 对比度自检 + 可直接落盘的皮肤 CSS
 *           来源：指定 / 直取 / 直取·须加深 / 直取·未达标 / 直取·提亮 / 派生 / 兜底 / 省略
 * [POS]: 配色映射层。palette-from-image.mjs（命令行）与 templates/theme-tuner.html（调参台）共用。
 *        **这一层不取色**，输入永远是一份候选清单；纯函数，不碰文件系统。
 * [PROTOCOL]: 变更时更新此头部
 *
 * ── 核心判断：取色简单，派色难 ────────────────────────────
 * 一张配色卡顶多给 3~5 个主色，一套皮肤要 9 个槽位。真正的活是**把颜色派到语义槽位上**。
 * 直取只有 3 个（card-bg / ink-strong / accent），其余 6 个是派生 —— 而且派生规则不是
 * 拍脑袋编的，是拿现有 4 套皮肤（奶油蓝 / 知识风 / 苔绿 / 暗夜）反推出来的：
 *
 *   槽位          派生规则                                4 套皮肤实测
 *   ────────────  ──────────────────────────────────────  ─────────────────────────────
 *   ink           ink-strong 往 bg 混 9%，保 ≥7:1         混比 0 / 6% / 9% / 12%
 *   ink-soft      ink 往 bg 混到对比 ≈4.7:1               实测 4.6~6.1:1（奶油蓝 2.62 是例外）
 *   ink-faint     ink 往 bg 混到对比 ≈2.4:1（装饰性）      实测 1.5~3.5:1
 *   divider       同上，目标 ≈1.5:1                        实测 1.21~1.78:1
 *   mark-bg       能直取就直取（卡里最艳的那块），否则 accent 提亮   高亮块在 4/4 套里都是最艳、且不暗于强调色
 *   quote-bg      默认 bg 与 ink 混 5%（几乎是底色）       知识风/苔绿/暗夜 ΔE ≤3.5
 *   mark-ink      **条件槽位**：只在字压不住高亮块时才输出（深色皮肤必踩）
 *
 * ── 2026-09-30：三个槽位不再由这里输出 ────────────────────
 * `accent-soft` / `stage-bg` / `card-shadow` 从 12 个槽位里摘掉了：
 *
 *   · accent-soft 全仓库只有一处消费（正文链接下划线），用「强调色的半透明版」
 *     就能表达，已下沉为 assets/base.css 里的默认算法。
 *   · stage-bg / card-shadow **只在多卡预览里可见** —— base.css 的 body.is-single
 *     会把页面背景换成 --card-bg、把投影关掉，导出 PNG 时这两个值一定被覆盖。
 *     它们不是皮肤的「身份色」，浅色方案已在 base.css 给了默认值。
 *
 * 所以皮肤文件从 12 行降到 9 行（深色底另加 --mark-ink 和两个预览色覆盖）。
 * 精简判据与全量对照表见工作区里的 xhs-card-palette-slim.html。
 *
 * 「目标对比度」用二分找混比实现（soften 系列），不是写死一个混合比例 ——
 * 同一个比例在深底和浅底上得到的对比度差得远，按**对比度**定才是稳定的。
 *
 * ── 天花板：有些阈值是这套配色本身给不起的 ───────────────
 * 字色能拿到的对比度上限由底色亮度决定：深底＝1.05/(L+0.05)，浅底＝(L+0.05)/0.05。
 * 底色亮度落在 0.10~0.35（中明度）是死区 —— --ink 要的 7:1 够不到，--ink-soft 的 4.5 贴着边。
 * 所以自检把「没过」分成两种：ceiling < min → 「顶格」（换参数也没用，只能压深底色或换卡），
 * 否则才是「不足」（我们没做到，该调）。不分开的话，人会对着 4.48 去追 4.5 追一晚上。
 * 告警里还会给出「底色压到哪个 hex 就够」（deepenUntil 二分算的，不是手写死的）。
 *
 * ink-strong 的兜底同理：**先跟万能兜底比一比再决定**。卡里对比度最高的候选如果比兜底更亮，
 * 就用它、标「直取·未达标」；否则才用兜底。实测紫底 #71749d 上，卡里的白 #ffffff 有 4.48:1，
 * 而兜底 #eceff3 只有 3.88:1 —— 直接跳兜底等于把卡自己的颜色扔了还更差。
 *
 * ── 为什么「面积最大 = 底色」不能当主规则 ─────────────────
 * 配色卡常是**等面积**色块，这条最顺手的启发式直接失效。所以 --bg/--accent 是接口的
 * 一部分，不是补丁。自动推断照跑，但会标出置信度，并在两个候选咬得很近时报警。
 */

import {
  clampToContrast,
  contrastOf,
  deltaE,
  lumOf,
  mix,
  parseColor,
  rgbToHsl,
  shade,
  tint,
  toHex,
} from './color.mjs';

/* ------------------------------------------------------------------ *
 * 槽位定义（顺序 = 写进 css 的顺序 = 报告里的顺序）
 * ------------------------------------------------------------------ */

export const SLOTS = [
  { key: 'card-bg', group: '底色', comment: '卡片底色' },
  { key: 'ink-strong', group: '文字', comment: '最重的字：标题' },
  { key: 'ink', group: '文字', comment: '正文颜色' },
  { key: 'ink-soft', group: '文字', comment: '次要文字、封面副标题' },
  { key: 'ink-faint', group: '文字', comment: '最浅的字：图片说明（装饰性，不卡对比度）' },
  { key: 'accent', group: '强调', comment: '序号、小标签、列表圆点、引用竖条' },
  { key: 'mark-bg', group: '块底色', comment: '==高亮== 的底色' },
  { key: 'mark-ink', group: '块底色', comment: '高亮块里的字色（深色皮肤必须显式给）', optional: true },
  { key: 'quote-bg', group: '块底色', comment: '引用 / 图片块的底色' },
  { key: 'divider', group: '分隔线', comment: '分隔线；同时决定 hairline 配图边框' },
];

/** 对比度自检项。min 为 0 表示「装饰性，仅报数不带结论」 */
const CHECKS = [
  { id: 'accent', a: 'accent', b: 'card-bg', min: 3, why: '序号、小标签、引用竖条会「像没印上去」' },
  { id: 'ink', a: 'ink', b: 'card-bg', min: 7, why: '正文发灰，长时间阅读累' },
  { id: 'ink-soft', a: 'ink-soft', b: 'card-bg', min: 4.5, why: '封面副标题发虚、读起来费劲' },
  { id: 'mark-ink', a: 'mark-ink', b: 'mark-bg', min: 4.5, why: '高亮块里的字看不见（深色皮肤最容易踩）' },
  { id: 'ink-faint', a: 'ink-faint', b: 'card-bg', min: 0, why: '装饰性，仅报数' },
  { id: 'divider', a: 'divider', b: 'card-bg', min: 0, why: '装饰性，仅报数' },
];

const T = {
  inkMin: 7, // --ink vs --card-bg 不能低于这个
  inkMix: 0.09, // ink-strong 往 bg 混多少变成 --ink
  soft: 4.7, // ink-soft 的对比度目标
  faint: 2.4, // ink-faint 的对比度目标（装饰性）
  divider: 1.5, // divider 的对比度目标（装饰性）
  accentMin: 3, // accent vs bg
  markInkMin: 4.5, // mark-ink vs mark-bg
  darkLum: 0.35, // bg 相对亮度低于此值 = 深色皮肤
  markTintLight: 0.62, // mark-bg 兜底：accent 往白混
  markTintDark: 0.14, // mark-bg 兜底：accent 往白混（深色皮肤的高亮块是亮的）
  quoteMix: 0.05, // quote-bg 兜底：bg 与 ink 混
  faintFloor: 12, // 强调色与字色至少差这么多 ΔE，否则不算「独立的强调色」
};

const FALLBACK = { light: '#212121', dark: '#eceff3' };

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 往 to 混，直到与 ref 的对比度降到 target 附近；返回略高于 target 的那一侧（宁深勿浅） */
function soften(from, to, ref, target) {
  const at = (t) => contrastOf(mix(from, to, t), ref);
  if (at(0) <= target) return toHex(from);
  if (at(1) >= target) return toHex(to);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > target) lo = mid;
    else hi = mid;
  }
  return toHex(mix(from, to, lo));
}

/** 往白里提，直到 fg 能在它上面看得清 */
function liftToContrast(fg, base, min) {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = toHex(tint(base, t));
    if (contrastOf(fg, c) >= min) return c;
  }
  return toHex(tint(base, 1));
}

/**
 * 底色压深到「这个字色能达标」为止，返回**最浅的那个达标值**。
 * 用途是把「只能把 --card-bg 压深」从一句空话变成具体数字 —— 不说压到多少，
 * 用户只能自己试。压到底还够不到（比如目标是纯白 21:1）就返回 null。
 */
function deepenUntil(fg, bgHex, target) {
  if (contrastOf(fg, '#000000') < target) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (contrastOf(fg, toHex(mix(bgHex, '#000000', mid))) < target) lo = mid;
    else hi = mid;
  }
  return toHex(mix(bgHex, '#000000', hi));
}

const satOf = (hex) => rgbToHsl(hex).s;
const shift = (hex, d) => toHex({ r: parseColor(hex).r + d, g: parseColor(hex).g + d, b: parseColor(hex).b + d });

/* ------------------------------------------------------------------ *
 * 映射
 * ------------------------------------------------------------------ */

/**
 * @param {{hex:string, share:number}[]} colors  候选色（会被按占比排序）
 * @param {object} opts
 *   bg / ink / accent / mark / quote  第几号（1 起）或 '#hex'
 *   direction  'auto' | 'light' | 'dark'
 *   clamp      false 则不把 accent 抬到 3:1（保留配色卡原色）
 * @returns {{direction, slots, checks, warnings, ambiguity, sources}}
 */
export function mapPalette(colors, opts = {}) {
  if (!Array.isArray(colors) || !colors.length) throw new Error('候选色清单是空的，没法映射。');
  const list = [...colors].sort((a, b) => b.share - a.share);

  const pick = (v, flag) => {
    if (v == null || v === '') return null;
    const s = String(v);
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      const c = list[n - 1];
      if (!c) throw new Error(`--${flag} ${n}：没有第 ${n} 号候选色（一共 ${list.length} 条）`);
      return c.hex;
    }
    if (!parseColor(s)) throw new Error(`--${flag} ${s}：认不出这个颜色（要 #rrggbb 或候选色编号）`);
    return toHex(s);
  };

  const warnings = [];
  const used = new Set();
  const src = {};

  /* ── ① 底色 ───────────────────────────────────────────── */
  let bg = pick(opts.bg, 'bg');
  if (bg) src['card-bg'] = '指定';
  else {
    bg = list[0].hex;
    src['card-bg'] = '直取';
    if (list[0].share < 0.5) {
      warnings.push(
        `底色是「占比最大」猜的（${bg}，只占 ${(list[0].share * 100).toFixed(1)}%）——` +
          `配色卡常是等面积色块，这条不可信，请确认或直接 --bg <编号>。`
      );
    }
  }
  used.add(bg);

  /* ── ② 深浅方向 ───────────────────────────────────────── */
  const direction =
    opts.direction && opts.direction !== 'auto' ? opts.direction : lumOf(bg) < T.darkLum ? 'dark' : 'light';
  const light = direction === 'light';
  // 这层底色能给出的对比度上限：深色皮肤＝白字能压出的最亮，浅色皮肤＝黑字能压出的最暗。
  // 用途是**区分「算法没做到」和「这个配色物理上做不到」**——后者报「不足」会误导人
  // 以为换个参数就能救（实测：紫底 4.48:1 对 ≥4.5 的目标永远差 0.02）。
  const ceiling = light ? (lumOf(bg) + 0.05) / 0.05 : 1.05 / (lumOf(bg) + 0.05);

  /* ── ③ 字色（最重的那一档）──────────────────────────────── */
  let inkStrong = pick(opts.ink, 'ink');
  if (inkStrong) src['ink-strong'] = '指定';
  else {
    const ok = list.filter((c) => c.hex !== bg && contrastOf(c.hex, bg) >= T.inkMin);
    const neutral = ok.filter((c) => satOf(c.hex) < 0.35);
    const pool = neutral.length ? neutral : ok;
    if (pool.length) {
      pool.sort((a, b) => b.share - a.share || contrastOf(b.hex, bg) - contrastOf(a.hex, bg));
      inkStrong = pool[0].hex;
      src['ink-strong'] = '直取';
    } else {
      // 一个候选都没达标。**别直接跳兜底** —— 卡里可能有个比兜底更亮的色。
      // 实测踩到（紫底 #71749d）：卡里的白 #ffffff 有 4.48:1，而万能兜底 #eceff3
      // 只有 3.88:1。兜底反而更差，还把卡自己的白丢掉了。先比一下，谁亮用谁。
      const fb = light ? FALLBACK.light : FALLBACK.dark;
      const best = list
        .filter((c) => c.hex !== bg)
        .sort((a, b) => contrastOf(b.hex, bg) - contrastOf(a.hex, bg))[0];
      const bestRatio = best ? contrastOf(best.hex, bg) : 0;
      if (best && bestRatio > contrastOf(fb, bg)) {
        inkStrong = best.hex;
        src['ink-strong'] = '直取·未达标';
      } else {
        inkStrong = fb;
        src['ink-strong'] = '兜底';
      }
      // 把「天花板」讲清楚：中明度底色天然上不去 7:1，这不是取色不准，是配色本身的物理限制。
      const fixBg = deepenUntil(inkStrong, bg, T.inkMin);
      warnings.push(
        `没有一个色能跟底色拉开 ${T.inkMin}:1，最好的只有 ${inkStrong}（${contrastOf(inkStrong, bg)}:1）。` +
          `底色相对亮度 ${lumOf(bg).toFixed(3)} 属中明度 —— 浅色字的天花板就是 ${ceiling.toFixed(2)}:1，` +
          `越浅的字档（--ink-soft / --ink-faint）能拉开的差距越小，层次会变扁。` +
          `标题这类大字（≥3:1 就够）不受影响；要正文也达标，` +
          (fixBg
            ? `把底色压深到 ${fixBg} 就够（--bg "${fixBg}"），或者干脆换一张卡。`
            : `只能换一张卡。`)
      );
    }
  }
  used.add(inkStrong);

  /* ── ④ 强调色 ─────────────────────────────────────────── */
  let accent = pick(opts.accent, 'accent');
  let clampNote = null;
  let ambiguity = null;
  if (accent) src.accent = '指定';
  else {
    const pool = list.filter((c) => !used.has(c.hex) && deltaE(c.hex, inkStrong) >= T.faintFloor);
    if (!pool.length) {
      // 只有底色和字色两个候选 —— 强调色一个都没剩下。
      // 真实卡片渲染图最常踩这个：强调色只出现在序号、引用竖条上，占比 <0.5%，
      // 被当碎色丢掉了。强调色是唯一**不能凭空造**的角色（它决定序号/小标签/竖条的颜色），
      // 所以这里必须停下来问，而不是编一个。
      // 注意：错误信息走 JSON 输出，所以只能是一行（换行会变成转义符没法看）。
      throw new Error(
        '颜色不够分角色：只有底色和字色两个候选，强调色没有着落。' +
          '喂的是「真实卡片渲染图」吧？强调色占比常低于 0.5% 会被当碎色丢掉 —— ' +
          '先放宽到 --min-share 0.005 --top 10 再试；' +
          '还是不行就手工指认 --accent <编号>（编号见上面的清单）或 --accent "#6b9bc7"；' +
          '最省事的是换成真正的配色卡，上面强调色是大色块，不会被丢。'
      );
    }
    const vivid = pool.filter((c) => contrastOf(c.hex, bg) >= T.accentMin && satOf(c.hex) >= 0.15);
    let ranked;
    if (vivid.length) {
      // 有能直接读的彩色：饱和度高的优先；饱和度接近的一档里挑**最深的** ——
      // 强调色是功能色（序号/竖条/小字），越浓越稳。不这么做的话，深色皮肤里
      // 「亮黄强调色」和「青柠高亮块」会互相抢位（暗夜实测踩到）。
      const bySat = [...vivid].sort((a, b) => satOf(b.hex) - satOf(a.hex) || b.share - a.share);
      const top = satOf(bySat[0].hex) - 0.12;
      ranked = bySat.filter((c) => satOf(c.hex) >= top).sort((a, b) => lumOf(a.hex) - lumOf(b.hex));
      src.accent = '直取';
    } else {
      // 卡里没有一个彩色能直接读（柔和配色很常见，奶油蓝的强调色只有 2.78:1）。
      // 这时要比的是**谁离达标最近**，不能用饱和度比 —— 否则会选中一个比强调色
      // 更亮的浅色块（实测：奶油蓝的 #c6dcf2 会抢掉 #6b9bc7 的位置）。
      // 反正接着就被 clampToContrast 压深，而压深不改色相，所以色相必须先选对。
      ranked = [...pool].sort(
        (a, b) => contrastOf(b.hex, bg) - contrastOf(a.hex, bg) || satOf(b.hex) - satOf(a.hex)
      );
      src.accent = '直取·须加深';
    }
    accent = ranked[0].hex;
    if (ranked.length > 1) {
      ambiguity = {
        chosen: accent,
        rivals: ranked.slice(1).map((c) => c.hex),
        hint: `这几个都在争强调色：${ranked.map((c) => c.hex).join(' / ')}。我选了 ${accent}，不是它就用 --accent <编号>。`,
      };
    }
  }

  if (opts.clamp !== false) {
    const picked = accent; // clamp 之前的那一版
    const c = clampToContrast(accent, bg, T.accentMin);
    if (c.changed) {
      clampNote = `强调色原本 ${accent} 压在底色上只有 ${c.ratioBefore}:1（<${T.accentMin}），保色相降明度到 ${c.hex}（${c.ratioAfter}:1）。`;
      accent = c.hex;
    }
    // clamp 之后要**把原色也记成已用**：否则同一个源色会被后面的 mark-bg 再直取一次，
    // 结果 --accent 和 --mark-bg 只差 ΔE 1 左右 —— 高亮块跟强调色元素糊成一片。
    // （实测：紫卡里 #d6cbe3 被 clamp 成 #dad0e5 当强调色，源色 #d6cbe3 又被 mark-bg 拿走。）
    used.add(picked);
  }
  used.add(accent);

  /* ── ④b 被占比阈值丢掉的色里，有没有更像强调色的？───────────
   * 配色卡常把强调色做成一个小色块或细色带（这张紫卡里的粉只占 1.9%），
   * 默认 --min-share 2% 会把它当碎色丢掉，于是强调色只能落到一个「将就」的浅色上、
   * 还要靠 clamp 压深。取色层丢的通常是噪声，但也可能是主角 —— 说一声比沉默好。
   * 只在「选中的那个是靠 clamp 救回来的」时才提，否则太吵。
   */
  if (!opts.accent && clampNote && Array.isArray(opts.all) && opts.all.length) {
    const kept = new Set(list.map((c) => c.hex));
    const missed = opts.all
      .filter((c) => !kept.has(c.hex) && !used.has(c.hex))
      .map((c) => ({ ...c, ratio: contrastOf(c.hex, bg), sat: satOf(c.hex) }))
      .filter((c) => c.sat >= 0.15 && c.ratio >= T.accentMin && deltaE(c.hex, inkStrong) >= T.faintFloor)
      .sort((a, b) => b.sat - a.sat || b.share - a.share);
    if (missed.length) {
      const m = missed[0];
      const need = Math.floor(m.share * 1000) / 1000;
      warnings.push(
        `有个更像强调色的色被占比阈值丢了：${m.hex}（只占 ${(m.share * 100).toFixed(1)}%，` +
          `饱和 ${m.sat.toFixed(2)}、对底色 ${m.ratio}:1 —— 直接达标，不用压深）。` +
          `想用它：--min-share ${need} 重跑，或直接 --accent "${m.hex}"。`
      );
    }
  }

  /* ── ⑤ 高亮块底色：能直取就直取 ────────────────────────── */
  let mark = pick(opts.mark, 'mark');
  if (mark) src['mark-bg'] = '指定';
  else {
    const accentLum = lumOf(accent);
    const pool = list
      .filter((c) => !used.has(c.hex) && deltaE(c.hex, inkStrong) >= T.faintFloor)
      // 高亮块要「比强调色亮、且是彩色」—— 但**亮度差只能当弱约束**：
      // 暗夜的强调色 #e9b552 和亮黄 #f2c94c 相对亮度只差 0.098，
      // 卡死 0.12 的门槛会让它退回「派生」，白白丢掉配色卡里现成的高亮色。
      // 真正挑色靠的是饱和度排序（高亮块永远是卡里最艳的那块）。
      .filter((c) => satOf(c.hex) >= 0.15 && lumOf(c.hex) >= accentLum - 0.05);
    if (pool.length) {
      pool.sort((a, b) => satOf(b.hex) - satOf(a.hex) || lumOf(b.hex) - lumOf(a.hex));
      mark = pool[0].hex;
      src['mark-bg'] = '直取';
    } else {
      mark = toHex(tint(accent, light ? T.markTintLight : T.markTintDark));
      src['mark-bg'] = '派生';
    }
  }
  used.add(mark);
  // 浅色皮肤的高亮块得让字读得出来；直取到的色太深就提亮它
  let markLifted = false;
  if (light && contrastOf(inkStrong, mark) < T.markInkMin) {
    mark = liftToContrast(inkStrong, mark, T.markInkMin);
    markLifted = true;
    src['mark-bg'] += '·提亮';
  }

  /* ── ⑥ 引用块底色：天生该「几乎等于底色」，所以优先派生 ──── */
  let quote = pick(opts.quote, 'quote');
  if (quote) src['quote-bg'] = '指定';
  else {
    // 只有卡里真多出一个「跟底色几乎一样、但确实不同」的色时才直取它
    const spare = list.filter(
      (c) => !used.has(c.hex) && c.hex !== mark && contrastOf(c.hex, bg) < 1.4 && deltaE(c.hex, bg) >= 1
    );
    if (spare.length) {
      quote = spare[0].hex;
      src['quote-bg'] = '直取';
    } else {
      quote = null;
      src['quote-bg'] = '派生';
    }
  }

  /* ── ⑦ 派生剩下的 ─────────────────────────────────────── */
  const ink = (() => {
    const v = toHex(mix(inkStrong, bg, T.inkMix));
    return contrastOf(v, bg) >= T.inkMin ? v : inkStrong;
  })();
  const values = {
    'card-bg': bg,
    'ink-strong': inkStrong,
    ink,
    'ink-soft': soften(ink, bg, bg, T.soft),
    'ink-faint': soften(ink, bg, bg, T.faint),
    accent,
    'mark-bg': mark,
    'quote-bg': quote || toHex(mix(bg, ink, T.quoteMix)),
    divider: soften(ink, bg, bg, T.divider),
  };
  for (const k of ['ink', 'ink-soft', 'ink-faint', 'divider']) {
    src[k] = src[k] || '派生';
  }

  // mark-ink：只在「最重的字压不住高亮块」时才显式给。
  // 深色皮肤必然踩 —— ink-strong 是近白色，压亮黄高亮块只有 1.47:1（暗夜实测），字直接消失。
  let markInk = null;
  if (contrastOf(inkStrong, values['mark-bg']) < T.markInkMin) {
    // 按顺序取**第一个达标的**，不是对比度最高的那个：优先用已有的语义色。
    // 深色皮肤的 bg 就是「纸色」，拿它当高亮块的字色最自然（暗夜手调的正是这个值）；
    // 只按对比度挑的话会冒出 #000a00 这种没来由的墨绿（压测卡实测）。
    const cands = light
      ? [toHex(shade(values['mark-bg'], 0.7)), toHex(shade(inkStrong, 0.3)), '#1b1e24']
      : [bg, toHex(shade(values['mark-bg'], 0.7)), inkStrong, FALLBACK.dark];
    markInk = cands.find((c) => contrastOf(c, values['mark-bg']) >= T.markInkMin) || shift(values['mark-bg'], -160);
    values['mark-ink'] = markInk;
    src['mark-ink'] = '派生';
  } else {
    src['mark-ink'] = '省略';
  }

  // 只有「底色本来就给不了 4.5:1」时才说这句话 —— 否则上面那条天花板告警已经解释了，
  // 这条会变成重复；而如果天花板够高、是我们自己没压到位，那才是真该修的。
  if (contrastOf(bg, inkStrong) < 4.5 && ceiling >= 4.5) {
    warnings.push(
      `底色与字色只有 ${contrastOf(bg, inkStrong)}:1（<4.5）—— 这套配色不适合承载小字正文，` +
        `封面标题这类大字（≥3:1 就够）还能用。要么放大字号，要么把 --card-bg 压深。`
    );
  }
  if (clampNote) warnings.push(clampNote);
  if (markLifted) {
    warnings.push(`直取到的高亮块色太深（字压不住），已提亮为 ${values['mark-bg']}。`);
  }

  /* ── ⑧ 自检 ───────────────────────────────────────────── */
  const checks = CHECKS.map((c) => {
    const a = values[c.a];
    const b = values[c.b];
    if (!a || !b) return null;
    const ratio = contrastOf(a, b);
    const ok = c.min === 0 ? null : ratio >= c.min;
    // 只有「跟底色比」的检查才受这个上限约束；mark-ink 比的是块底色，另算
    const capped = !ok && c.b === 'card-bg' && ceiling < c.min;
    return {
      id: c.id,
      label: `--${c.a} vs --${c.b}`,
      aKey: c.a,
      bKey: c.b,
      a,
      b,
      ratio,
      min: c.min,
      why: c.why,
      ok,
      ceiling: capped ? Math.round(ceiling * 100) / 100 : null,
      delta: c.min === 0 ? null : Math.round((ratio - c.min) * 100) / 100,
    };
  }).filter(Boolean);

  const slots = SLOTS.filter((s) => !s.optional || values[s.key] != null).map((s) => ({
    key: s.key,
    group: s.group,
    comment: s.comment,
    value: values[s.key],
    source: src[s.key] || '派生',
  }));

  return { direction, slots, checks, warnings, ambiguity, usedHexes: [...used] };
}

/** 只把槽位数组转成 { '--card-bg': '#fcf9e6', ... } —— 调参台/测试用 */
export function slotMap(slots) {
  const o = {};
  for (const s of slots) o[`--${s.key}`] = s.value;
  return o;
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

const PAD_KEY = 16; // '--ink-strong:' 是 13 字符
const PAD_VAL = 12; // 值最长是 mark-ink 的 7 位 hex（'#1b1e24;' 8 字符），留点呼吸

/**
 * 生成一份**可以直接当皮肤用**的 css。
 * 注意：@theme-meta 之后、首个 :root 之前的这段前言里不能再出现字符串 ":root"
 * （templates.mjs 用 split(':root') 截头部），也别出现 "@xxx:" 形式的字样。
 */
export function renderThemeCss({ meta, map, sourceLabel, date }) {
  const { direction, slots, checks, warnings } = map;
  const get = (k) => slots.find((s) => s.key === k)?.value;
  const keys = ['card-bg', 'ink-strong', 'accent'].map((k) => `--${k}=${get(k)}`).join('  ');

  const head = [];
  head.push('/* @theme-meta');
  head.push(`   @name:    ${meta.name}`);
  head.push(`   @slug:    ${meta.slug}`);
  head.push(`   @badges:  草稿`);
  head.push(`   @aliases: ${meta.aliases}`);
  head.push(`   @summary: ${meta.summary}`);
  head.push(`   @use:     ${meta.use}`);
  head.push(`   @order:   90`);
  head.push('*/');
  head.push('');
  head.push('/* ============================================================');
  head.push(`   xhs-card-studio :: 皮肤草稿 —— ${meta.name}`);
  head.push('   ------------------------------------------------------------');
  head.push(`   来源  ${sourceLabel}`);
  head.push(`   生成  ${date}   node scripts/palette-from-image.mjs --write`);
  head.push(`   方向  ${direction === 'dark' ? '深色底' : '浅色底'}`);
  head.push('');
  head.push('   角色分配');
  for (const s of slots) {
    if (s.source === '派生' || s.source === '省略') continue;
    head.push(`     ${`--${s.key}`.padEnd(14)} ${String(s.value).padEnd(10)} ${s.source}`);
  }
  head.push('');
  head.push('   标着「派生」的槽位由上面这几个色算出来（规则见 references/theming.md），');
  head.push('   它们是可以用手调的旋钮 —— 改完记得重跑一遍对比度自检。');
  head.push('');
  head.push('   启用（现在躺在 _draft/ 里，模板清单会自动忽略，不会污染画廊与预览图自检）');
  head.push(`     mv assets/themes/_draft/${meta.slug}.css assets/themes/${meta.slug}.css`);
  head.push('');
  head.push('   对比度自检（生成时算的）');
  for (const c of checks) {
    const verdict =
      c.ok === null
        ? '仅报数'
        : c.ok
          ? 'OK'
          : c.ceiling
            ? `顶格（该底色上限 ${c.ceiling}）`
            : `不够（差 ${Math.abs(c.delta)}）`;
    head.push(`     ${`--${c.id}`.padEnd(12)} vs ${`--${c.bKey}`.padEnd(10)} ${c.ratio.toFixed(2).padStart(6)}:1   ` +
      `${c.min ? `目标 ≥${c.min}` : '装饰性    '}   ${verdict}`);
  }
  if (warnings.length) {
    head.push('');
    head.push('   ⚠️ 生成时的告警');
    for (const w of warnings) head.push(`     · ${w}`);
  }
  head.push('   ============================================================ */');
  head.push('');

  const body = [':root {'];
  body.push('  /* ---------- 配色：9 个槽位（深色底会多一行 --mark-ink） ---------- */');
  let group = null;
  for (const s of slots) {
    if (s.group !== group) {
      group = s.group;
      body.push('');
      body.push(`  /* ${group} */`);
    }
    const key = `--${s.key}:`.padEnd(PAD_KEY);
    body.push(`  ${key}${`${s.value};`.padEnd(PAD_VAL)}/* ${s.source} · ${s.comment} */`);
  }
  body.push('}');
  body.push('');
  return head.concat(body).join('\n');
}

/** 人看的报告（命令行的第 ③ ④ 段） */
export function renderReport({ meta, map, sourceLabel }) {
  const out = [];
  out.push('');
  out.push(`【② 角色分配】${sourceLabel}`);
  out.push('');
  out.push('  槽位            值                          来源');
  out.push('  ──────────────  ──────────────────────────  ─────────────────');
  for (const s of map.slots) {
    const mark = s.source === '省略' ? '（不用写）' : s.source;
    const val = String(s.value);
    if (val.length > 26) {
      out.push(`  ${`--${s.key}`.padEnd(16)}${val}`);
      out.push(`  ${''.padEnd(16)}${mark} · ${s.comment}`);
    } else {
      out.push(`  ${`--${s.key}`.padEnd(16)}${val.padEnd(28)}${mark} · ${s.comment}`);
    }
  }
  out.push('');
  out.push('【③ 对比度自检】');
  out.push('');
  out.push('  检查项                        比值    目标      结论');
  out.push('  ────────────────────────────  ──────  ────────  ────────────────────');
  for (const c of map.checks) {
    const verdict =
      c.ok === null
        ? '装饰性，仅报数'
        : c.ok
          ? '通过'
          : c.ceiling
            ? `⚠️ 顶格了（该底色上限 ${c.ceiling}）`
            : `⚠️ 不足，还差 ${Math.abs(c.delta)}`;
    out.push(
      `  ${c.label.padEnd(30)}${String(c.ratio).padStart(5)}:1  ` +
        `${(c.min ? `≥${c.min}` : '—').padEnd(8)}  ${verdict}`
    );
  }
  if (map.warnings.length) {
    out.push('');
    out.push('【⚠️ 告警】');
    for (const w of map.warnings) out.push(`  · ${w}`);
  }
  if (map.ambiguity) {
    out.push('');
    out.push(`【⚠️ 角色有歧义】${map.ambiguity.hint}`);
  }
  return out.join('\n');
}
