/* 生成物 —— 由 node scripts/build-tuner.mjs 从 assets/ 现读产出，不要手改。
   改皮肤/边框请改 assets/ 下的 css，然后重跑：
     node scripts/build-tuner.mjs   （刷新本文件）
     node scripts/build-gallery.mjs （刷新 docs/gallery.html）
     node scripts/build-preview.mjs （刷新 README 门面图）
*/
window.__XHS_TPL__ = {
  "themes": [
    {
      "key": "default",
      "name": "奶油蓝",
      "badges": "默认",
      "slug": "cream",
      "aliases": [
        "default",
        "默认",
        "奶油蓝",
        "creamblue",
        "cream-blue"
      ],
      "summary": "奶油黄底 + 淡蓝点缀，整体清淡克制",
      "order": 1,
      "decls": {
        "--card-bg": "#fcf9e6",
        "--stage-bg": "#eef3f7",
        "--ink-strong": "#212121",
        "--ink": "#212121",
        "--ink-soft": "#7d9fbf",
        "--ink-faint": "#bcd0e2",
        "--accent": "#6b9bc7",
        "--accent-soft": "#e5f0f6",
        "--mark-bg": "#c6dcf2",
        "--quote-bg": "#c6dcf2",
        "--divider": "#a5c0db",
        "--card-shadow": "0 18px 48px rgba(23, 32, 45, 0.10)"
      }
    },
    {
      "key": "知识风",
      "name": "知识风",
      "badges": "白底红",
      "slug": "knowledge",
      "aliases": [
        "知识风",
        "干净知识风",
        "knowledge",
        "clean"
      ],
      "summary": "纯白底 + 红强调，干净利落",
      "order": 2,
      "decls": {
        "--card-bg": "#ffffff",
        "--stage-bg": "#eceff2",
        "--ink-strong": "#16181d",
        "--ink": "#2f343c",
        "--ink-soft": "#5c646f",
        "--ink-faint": "#9aa3ad",
        "--accent": "#d9483b",
        "--accent-soft": "#fbe9e6",
        "--mark-bg": "#ffe9a8",
        "--quote-bg": "#f7f8fa",
        "--divider": "#e6eaee",
        "--card-shadow": "0 18px 48px rgba(23, 32, 45, 0.10)"
      }
    },
    {
      "key": "暗夜",
      "name": "暗夜",
      "badges": "深色底",
      "slug": "night",
      "aliases": [
        "暗夜",
        "夜色",
        "深色",
        "暗色",
        "dark",
        "night"
      ],
      "summary": "深炭蓝底 + 琥珀强调，在白底信息流里辨识度最高",
      "order": 3,
      "decls": {
        "--card-bg": "#1b1e24",
        "--stage-bg": "#0f1115",
        "--ink-strong": "#f5f6f8",
        "--ink": "#d5dae2",
        "--ink-soft": "#98a3b3",
        "--ink-faint": "#6a7484",
        "--accent": "#e9b552",
        "--accent-soft": "#3d3524",
        "--mark-bg": "#f2c94c",
        "--mark-ink": "#1b1e24",
        "--quote-bg": "#24282f",
        "--divider": "#333a44",
        "--card-shadow": "0 18px 48px rgba(0, 0, 0, 0.45)"
      }
    },
    {
      "key": "苔绿",
      "name": "苔绿",
      "badges": "浅绿",
      "slug": "sage",
      "aliases": [
        "苔绿",
        "鼠尾草",
        "sage",
        "moss"
      ],
      "summary": "浅鼠尾草底 + 苔绿强调，四套里最安静的一套",
      "order": 4,
      "decls": {
        "--card-bg": "#f2f5ee",
        "--stage-bg": "#e4e9dd",
        "--ink-strong": "#1f2a22",
        "--ink": "#2b3830",
        "--ink-soft": "#5f7064",
        "--ink-faint": "#a3b0a6",
        "--accent": "#4a7c59",
        "--accent-soft": "#dce8dc",
        "--mark-bg": "#cfe3b8",
        "--quote-bg": "#e7eee1",
        "--divider": "#c3cfc2",
        "--card-shadow": "0 18px 48px rgba(31, 42, 34, 0.10)"
      }
    }
  ],
  "frames": [
    {
      "key": "hairline",
      "name": "细描边",
      "aliases": [
        "hairline",
        "a",
        "细描边",
        "细线"
      ],
      "summary": "8px 细线框住配图，克制不抢戏",
      "order": 1,
      "w": "8px",
      "color": "var(--divider)",
      "shadow": "none"
    },
    {
      "key": "paper",
      "name": "相纸框",
      "aliases": [
        "paper",
        "c",
        "相纸",
        "相纸框",
        "白框",
        "相纸白框"
      ],
      "summary": "粗边填卡片底色 + 投影，图「浮」起来",
      "order": 2,
      "w": "40px",
      "color": "var(--card-bg)",
      "shadow": "0 14px 34px rgba(23, 32, 45, 0.18)"
    },
    {
      "key": "none",
      "name": "无边框",
      "aliases": [
        "none",
        "无",
        "无边框",
        "不要边框"
      ],
      "summary": "配图光边贴着版面，什么都不加",
      "order": 3,
      "w": "0px",
      "color": "transparent",
      "shadow": "none"
    }
  ],
  "themeVarKeys": [
    "--accent",
    "--accent-soft",
    "--card-bg",
    "--card-shadow",
    "--divider",
    "--ink",
    "--ink-faint",
    "--ink-soft",
    "--ink-strong",
    "--mark-bg",
    "--mark-ink",
    "--quote-bg",
    "--stage-bg"
  ],
  "themeCount": 4,
  "frameCount": 3
};
