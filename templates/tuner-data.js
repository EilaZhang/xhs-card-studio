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
        "--ink-strong": "#212121",
        "--ink": "#212121",
        "--ink-soft": "#7d9fbf",
        "--ink-faint": "#bcd0e2",
        "--accent": "#6b9bc7",
        "--mark-bg": "#c6dcf2",
        "--quote-bg": "#c6dcf2",
        "--divider": "#a5c0db",
        "--body-size": "36px",
        "--body-leading": "1.72",
        "--quote-size": "44px"
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
        "--ink-strong": "#f5f6f8",
        "--ink": "#d5dae2",
        "--ink-soft": "#98a3b3",
        "--ink-faint": "#6a7484",
        "--accent": "#e9b552",
        "--mark-bg": "#f2c94c",
        "--mark-ink": "#1b1e24",
        "--quote-bg": "#24282f",
        "--divider": "#333a44",
        "--stage-bg": "#0f1115",
        "--card-shadow": "0 18px 48px rgba(0, 0, 0, 0.45)"
      }
    },
    {
      "key": "暮紫",
      "name": "暮紫",
      "badges": "深色底",
      "slug": "dusk",
      "aliases": [
        "暮紫",
        "紫霞",
        "紫夜",
        "dusk",
        "purple",
        "violet"
      ],
      "summary": "深靛蓝底 + 奶油白字 + 粉强调，冷底暖字的对照",
      "order": 5,
      "decls": {
        "--card-bg": "#4e506c",
        "--ink-strong": "#fff0e3",
        "--ink": "#fff0e3",
        "--ink-soft": "#d1c7c4",
        "--ink-faint": "#918d99",
        "--accent": "#f7d0d1",
        "--mark-bg": "#f8d7d7",
        "--mark-ink": "#4e506c",
        "--quote-bg": "#575872",
        "--divider": "#6c6b80",
        "--stage-bg": "#2c2e3e",
        "--card-shadow": "0 18px 48px rgba(0, 0, 0, 0.45)"
      }
    },
    {
      "key": "普鲁士蓝",
      "name": "普鲁士蓝",
      "badges": "米白底",
      "slug": "prussian",
      "aliases": [
        "普鲁士蓝",
        "雾霾蓝",
        "藏青",
        "prussian",
        "prussianblue",
        "prussian-blue",
        "navy"
      ],
      "summary": "米白底 + 普鲁士蓝与藏青，低饱和冷调，纸感克制",
      "order": 6,
      "decls": {
        "--card-bg": "#efefe7",
        "--ink-strong": "#0f315e",
        "--ink": "#35506e",
        "--ink-soft": "#556c83",
        "--ink-faint": "#8e9da8",
        "--accent": "#617a99",
        "--mark-bg": "#b9c4c6",
        "--quote-bg": "#ffffff",
        "--divider": "#b9c4c6",
        "--body-size": "36px",
        "--body-leading": "1.72",
        "--quote-size": "44px"
      }
    },
    {
      "key": "松墨",
      "name": "松墨",
      "badges": "深色底",
      "slug": "pine",
      "aliases": [
        "松墨",
        "墨绿",
        "森绿",
        "pine",
        "forest",
        "deepgreen"
      ],
      "summary": "深墨绿底 + 干枯玫瑰粉强调 + 薄荷高亮，低饱和莫兰迪",
      "order": 7,
      "decls": {
        "--card-bg": "#43664a",
        "--ink-strong": "#ffffff",
        "--ink": "#ededed",
        "--ink-soft": "#d5ddd6",
        "--ink-faint": "#96b19c",
        "--accent": "#d9b8b8",
        "--mark-bg": "#d4f9e9",
        "--mark-ink": "#43664a",
        "--quote-bg": "#4c6d53",
        "--divider": "#638069",
        "--stage-bg": "#2e4a35",
        "--card-shadow": "0 18px 48px rgba(0, 0, 0, 0.45)",
        "--body-size": "36px",
        "--body-leading": "1.72",
        "--quote-size": "44px"
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
    "--body-leading",
    "--body-size",
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
    "--quote-size",
    "--stage-bg"
  ],
  "themeCount": 5,
  "frameCount": 3
};
