#!/usr/bin/env node
/**
 * [INPUT]: 无 —— 纯函数，颜色数学
 * [OUTPUT]: 具名导出：解析 / 转换 / 对比度 / 混合 / 明度约束 / 色差
 * [POS]: 基础设施层。**唯一一份**颜色数学来源，供 palette-from-image.mjs 与
 *        （将来的）调参台共用。不要在各个脚本里各写一份 hex->rgb。
 * [PROTOCOL]: 变更时更新此头部
 *
 * ── 约定（很重要，别改）─────────────────────────────────
 *
 * 1) **混合在 sRGB（gamma 编码）空间做**，不是线性光。
 *    这样 mix()/tint()/shade() 的结果跟 CSS `color-mix(in srgb, …)` 一致，
 *    也跟设计师在调色板里手拖得到的结果一致。线性光混合会得出「更正确但不像」
 *    的中间色 —— 本项目要的是可预期、能跟 CSS 对上。
 *
 * 2) **对比度一律按 WCAG 2.x**：ratio = (L1 + 0.05) / (L2 + 0.05)，
 *    L = 0.2126R + 0.7152G + 0.0722B，R/G/B 先做 sRGB 反伽马。
 *    阈值表见 references/theming.md。
 *
 * 3) **色差用 CIE76 ΔE**（Lab 空间欧氏距离）。
 *    CIE76 不完美（CIEDE2000 更准），但它够用、够短、可复现。
 *    参考量级：ΔE < 2.3 肉眼基本看不出；< 6 需要并排仔细看；> 10 一眼就是两个色。
 *    验收用的是它，所以别随手换成别的度量 —— 阈值会跟着失效。
 */

/* ------------------------------------------------------------------ *
 * 解析与格式化
 * ------------------------------------------------------------------ */

/** '#fcf9e6' / 'fcf9e6' / '#abc' / 'rgb(1,2,3)' -> {r,g,b}；看不懂返回 null */
export function parseColor(input) {
  if (!input) return null;
  if (typeof input === 'object' && input !== null) {
    const { r, g, b } = input;
    if ([r, g, b].every((v) => Number.isFinite(v))) return { r: clamp255(r), g: clamp255(g), b: clamp255(b) };
    return null;
  }
  const s = String(input).trim().toLowerCase();
  const rgbM = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgbM) return { r: clamp255(+rgbM[1]), g: clamp255(+rgbM[2]), b: clamp255(+rgbM[3]) };
  const hex = s.replace(/^#/, '');
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

export function toHex(c) {
  const { r, g, b } = typeof c === 'string' ? parseColor(c) : c;
  return '#' + [r, g, b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('');
}

/** 给终端用的真彩色块（不是给图用的）。NO_COLOR / 非 TTY 时返回空串 */
export function swatch(c, width = 4, force) {
  const on = force !== undefined ? force : (process.env.NO_COLOR ? false : Boolean(process.stdout.isTTY));
  if (!on) return '';
  const { r, g, b } = typeof c === 'string' ? parseColor(c) : c;
  const block = ' '.repeat(width);
  return `\u001b[48;2;${r};${g};${b}m${block}\u001b[0m`;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Number(v) || 0));
}

/* ------------------------------------------------------------------ *
 * 对比度（WCAG 2.x）
 * ------------------------------------------------------------------ */

export function luminance(c) {
  const { r, g, b } = typeof c === 'string' ? parseColor(c) : c;
  const lin = (v) => {
    const x = clamp255(v) / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 相对亮度，0~1，保留 3 位小数（报告里用） */
export function lumOf(c) {
  return Math.round(luminance(c) * 1000) / 1000;
}

/** 对比度比值，如 4.51。任意顺序，结果 >= 1 */
export function contrast(c1, c2) {
  const a = luminance(c1);
  const b = luminance(c2);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** 对比度，保留 2 位小数 */
export function contrastOf(c1, c2) {
  return Math.round(contrast(c1, c2) * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * HSL
 * ------------------------------------------------------------------ */

/** {r,g,b} -> {h:0~360, s:0~1, l:0~1} */
export function rgbToHsl(c) {
  const { r, g, b } = typeof c === 'string' ? parseColor(c) : c;
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
    else if (max === G) h = ((B - R) / d + 2) * 60;
    else h = ((R - G) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(s * 1000) / 1000, l: Math.round(l * 1000) / 1000 };
}

/** {h,s,l} -> {r,g,b}；h 任意度数，s/l 0~1 */
export function hslToRgb({ h, s, l }) {
  const H = ((h % 360) + 360) % 360;
  const S = Math.max(0, Math.min(1, s));
  const L = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let rgb;
  if (H < 60) rgb = [c, x, 0];
  else if (H < 120) rgb = [x, c, 0];
  else if (H < 180) rgb = [0, c, x];
  else if (H < 240) rgb = [0, x, c];
  else if (H < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/** 只换明度，色相与饱和度原样保留 */
export function withLightness(c, l) {
  const hsl = rgbToHsl(c);
  return hslToRgb({ h: hsl.h, s: hsl.s, l });
}

/** 只换饱和度 */
export function withSaturation(c, s) {
  const hsl = rgbToHsl(c);
  return hslToRgb({ h: hsl.h, s, l: hsl.l });
}

/* ------------------------------------------------------------------ *
 * 混合
 * ------------------------------------------------------------------ */

/** sRGB 空间线性插值：t=0 得 a，t=1 得 b（对应 CSS color-mix(in srgb)） */
export function mix(a, b, t) {
  const A = typeof a === 'string' ? parseColor(a) : a;
  const B = typeof b === 'string' ? parseColor(b) : b;
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(A.r + (B.r - A.r) * k),
    g: Math.round(A.g + (B.g - A.g) * k),
    b: Math.round(A.b + (B.b - A.b) * k),
  };
}

/** 往白里混 t（0~1） */
export function tint(c, t) {
  return mix(c, '#ffffff', t);
}

/** 往黑里混 t（0~1） */
export function shade(c, t) {
  return mix(c, '#000000', t);
}

/* ------------------------------------------------------------------ *
 * 对比度约束
 * ------------------------------------------------------------------ */

/**
 * 把 fg 的明度往「远离 bg」的方向推，直到对比度 >= min。
 * 色相、饱和度都保留 —— 调出来的还是同一个颜色，只是深浅变了。
 *
 * 返回 { hex, changed, ratioBefore, ratioAfter, lightness }，changed=false 表示原本就达标。
 *
 * 为什么要它：调色卡里取到的强调色经常「好看但太浅」（奶油蓝皮肤就踩过，
 * 见 references/theming.md —— 原 accent 只有 1.27:1，等于没印上去）。
 * 判阈值、算最小改动，是机器该干的活，不该丢给人肉眼看。
 */
export function clampToContrast(fg, bg, min = 3) {
  const before = contrast(fg, bg);
  const start = typeof fg === 'string' ? parseColor(fg) : fg;
  if (before >= min) {
    return {
      hex: toHex(start),
      changed: false,
      ratioBefore: Math.round(before * 100) / 100,
      ratioAfter: Math.round(before * 100) / 100,
      lightness: rgbToHsl(start).l,
    };
  }
  const hsl = rgbToHsl(start);
  // 底色是浅的 -> 往暗推（L 趋向 0）；底色是深的 -> 往亮推（L 趋向 1）
  const goDark = luminance(bg) >= 0.5;
  const target = goDark ? 0 : 1;
  let lo = Math.min(hsl.l, target);
  let hi = Math.max(hsl.l, target);
  let best = null;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const cand = hslToRgb({ h: hsl.h, s: hsl.s, l: mid });
    if (contrast(cand, bg) >= min) {
      best = cand;
      // 达标了，往「改动更小」的方向收：即往原始 L 靠
      if (goDark) lo = mid;
      else hi = mid;
    } else {
      if (goDark) hi = mid;
      else lo = mid;
    }
  }
  // 二分的收敛方向可能取不到值（极端饱和色推不到目标），兜底用端点
  if (!best) best = hslToRgb({ h: hsl.h, s: hsl.s, l: target });
  const ratioAfter = contrast(best, bg);
  return {
    hex: toHex(best),
    changed: true,
    ratioBefore: Math.round(before * 100) / 100,
    ratioAfter: Math.round(ratioAfter * 100) / 100,
    lightness: rgbToHsl(best).l,
  };
}

/* ------------------------------------------------------------------ *
 * 色差（CIE76 / Lab）
 * ------------------------------------------------------------------ */

function rgbToLab(c) {
  const { r, g, b } = typeof c === 'string' ? parseColor(c) : c;
  const lin = (v) => {
    const x = clamp255(v) / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  // sRGB -> XYZ (D65)
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 色差。ΔE<2.3 肉眼基本看不出，<6 要并排看，>10 一眼两色 */
export function deltaE(c1, c2) {
  const A = rgbToLab(c1);
  const B = rgbToLab(c2);
  const d = Math.sqrt((A.L - B.L) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
  return Math.round(d * 10) / 10;
}
