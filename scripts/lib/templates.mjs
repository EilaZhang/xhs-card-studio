/**
 * [INPUT]: assets/themes/*.css、assets/frames/*.css
 * [OUTPUT]: 两类视觉模板的清单 + 别名表 + 标签 + :root 声明
 * [POS]: 视觉模板清单的唯一读取入口
 * [PROTOCOL]: 变更时更新此头部，并同步 build-cards.mjs / build-gallery.mjs
 *
 * 为什么要有这个模块：
 * 皮肤和边框的「身份」（显示名、别名、摘要、适用场景）都写在各自的 css 文件
 * 头部（@theme-meta / @frame-meta），不再在代码里维护第二份别名表。
 * 于是：
 *   · 新增一套视觉模板 = 新增一个 css 文件，代码零改动
 *   · 出图脚本和总览页读的是同一份身份，不可能出现「命令行认识、画廊不显示」
 *     这种漂移（2026-09-17 整理视觉模板时定的规矩）
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 剥掉注释后取出 :root 块里的声明。
 * 总览页要把模板变量当内联 style 作用到某一小块区域上，需要这段文本。
 */
export function rootDecls(css) {
  const clean = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = clean.match(/:root\s*\{([\s\S]*?)\}/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * 读一类模板目录。
 * 元信息只从第一个 :root 之前的前言里找 —— 免得把正文里出现的 @ 误当元信息。
 */
function readTemplateDir(dir, dirLabel) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.css')).sort()) {
    const key = f.replace(/\.css$/, '');
    const css = fs.readFileSync(path.join(dir, f), 'utf8');
    const head = css.split(':root')[0];
    const field = (n) => {
      const m = head.match(new RegExp(`@${n}\\s*:\\s*(.+)`));
      return m ? m[1].trim() : '';
    };
    out.push({
      key,
      name: field('name') || key,
      // slug：ASCII 短名，用于生成产物文件名（README 预览图等），避免中文文件名
      slug: field('slug') || key,
      badges: field('badges'),
      aliases: field('aliases').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      summary: field('summary'),
      use: field('use'),
      order: Number(field('order')) || 99,
      file: `${dirLabel}/${f}`,
      decls: rootDecls(css),
      css,
    });
  }
  // 顺序 = 命令行报错清单和总览页的展示顺序
  return out.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** 别名 → key 的映射（大小写不敏感）。文件名本身永远可以当名字用。 */
function buildAliasMap(list) {
  const map = new Map();
  for (const t of list) {
    map.set(t.key.toLowerCase(), t.key);
    for (const a of t.aliases) map.set(a.toLowerCase(), t.key);
  }
  return map;
}

/** 报告给用户看的名字：有 badges 就加括号，例如「奶油蓝（默认）」。 */
export function makeLabeler(list) {
  return (key) => {
    const t = list.find((x) => x.key === key);
    if (!t) return key;
    return t.badges ? `${t.name}（${t.badges}）` : t.name;
  };
}

export function loadTemplates(skillRoot) {
  const themes = readTemplateDir(path.join(skillRoot, 'assets', 'themes'), 'assets/themes');
  const frames = readTemplateDir(path.join(skillRoot, 'assets', 'frames'), 'assets/frames');
  return {
    themes,
    frames,
    themeAliases: buildAliasMap(themes),
    frameAliases: buildAliasMap(frames),
    themeLabel: makeLabeler(themes),
    frameLabel: makeLabeler(frames),
  };
}
