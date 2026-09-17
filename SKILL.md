---
name: xhs-card-studio
description: 把图文稿件自动生成固定风格的小红书 3:4 图片。当用户要求把文章/稿子/笔记/长文做成小红书图文、生成小红书配图或封面、把 markdown 转成小红书图片、做小红书轮播图/九宫格、或者提到「图文卡片」「3:4 卡片」「1080x1440 出图」「小红书图集」时使用。流程强制三段式：先生成 HTML 供用户确认和修改，确认后才渲染 PNG；内置 4 套皮肤（含深色底）和 3 种配图边框，支持用可视化调参台自定义皮肤。
metadata:
  version: 0.8.0
  visibility: public
  license: MIT
---

# xhs-card-studio — 稿件到小红书图文

> 装进 agent 之前先看 [`README.md`](README.md)（给人看的）。
> 本文件是给 agent 看的执行规范。

**依赖**：Node.js 18+；Playwright Chromium 或系统 Chrome/Edge（详见 README「依赖」）。
**路径**：下文 `$SKILL` = 本技能所在目录。脚本自己定位根目录，任意 cwd 下用绝对路径调用即可。

把一篇 Markdown 稿件切成若干张 **3:4 卡片（1080×1440）**，先出 HTML 让你确认和修改，确认后一次渲染成能直接发小红书的 PNG。

稿件可以是普通 Markdown，也可以**直接拿 Obsidian 笔记来用**：`![[图.png]]` 嵌入、`==高亮==`、拿数字 `1 2 3` 标页码都原样识别；附件会自动从稿件所在目录逐级向上查找，直到 vault 根，所以笔记在子目录、图在根目录也不用挪。详见 [references/authoring.md](references/authoring.md)。

## 核心原则（不要跳步）

**用户明确要求：先 HTML 确认，再出图。** 所以任何一次任务都必须走完这三步：

1. **生成** —— 跑 `build-cards.mjs`，得到 `cards.html`
2. **确认** —— 用 `present_files` 把 `cards.html` 打开给用户看，说明切成了几页、每页是什么、有没有警告，然后**停下来等反馈**
3. **出图** —— 用户说「可以 / 没问题 / 出图」之后，才跑 `render.mjs` 渲染 PNG

不要一口气跑完两步直接甩 PNG 给用户。也不要自己判断「内容很简单就不用确认了」。

## 用户问「这个技能怎么调用」时怎么答

**推荐：直接说人话。** 不需要记命令、不需要提技能名。下面这些说法都会自动触发：

| 用户说 | 触发点 |
| --- | --- |
| 把这篇文章 / 这篇稿子做成小红书图文 | 标准入口 |
| 这篇笔记生成小红书配图 / 封面 | 同上 |
| 把 markdown / Obsidian 笔记转成小红书图片 | 同上 |
| 做一版 3:4 卡片 / 1080x1440 出图 / 小红书图集 | 同上 |
| 做小红书轮播图 / 九宫格 | 同上 |

**手动方式**（用户想自己在终端跑时给他这两行）：

```bash
node "$SKILL/scripts/build-cards.mjs" <稿件路径> --out <输出目录>   # 第 1 步：出 HTML
node "$SKILL/scripts/render.mjs" <输出目录>/cards.html --out <输出目录>/png   # 第 2 步：确认后才出图
```

**一定要顺带说清的 4 件事：**

1. 技能装在**用户级**目录（WorkBuddy：`~/.workbuddy/skills/xhs-card-studio/`），**任何工作区都能用**，不用重装、不用复制。
2. 两步走、中间必须停：**先出 HTML 给他看 → 他点头 → 才渲染 PNG**。这就是他当初的核心要求。
3. 出图默认落在**当前工作区** `<cwd>/xhs-cards/<稿件名>/`，方便他直接预览和取走。
4. 会问他的视觉选项只有两个：**皮肤**（默认奶油蓝，另有知识风/暗夜/苔绿）和**配图边框**（默认细描边）。
   嫌麻烦就说「都按默认」。**拿不准时先把 `docs/gallery.html` 给他看** —— 4 套皮肤 × 3 种边框的实际效果一目了然，比描述色值快得多。

## 命令

两个脚本都会用 `__dirname` 自推技能根目录（`SKILL_ROOT`），**所以在任何目录下用绝对路径调用都行，不必先 `cd`**。
下文统一用 `$SKILL` 指代本技能所在目录：

```bash
SKILL="/path/to/xhs-card-studio"    # 换成实际安装位置
```

> **WorkBuddy 环境**：技能装在 `~/.workbuddy/skills/xhs-card-studio/`，托管 Node 在
> `~/.workbuddy/binaries/node/versions/<版本>/node.exe`。直接写 `node` 或写那个绝对路径都可以。

### 第 1 步：稿件 → HTML

```bash
node "$SKILL/scripts/build-cards.mjs" <稿件路径> --out <输出目录>
```

输出目录建议放在**当前工作区**下，方便预览与交付：`<cwd>/xhs-cards/<稿件名>/`

产物：

| 文件 | 用途 |
| --- | --- |
| `cards.html` | 全部卡片堆叠，**给用户预览确认的主文件**（溢出会自动标红警告） |
| `slides/pNN.html` | 单页文件，渲染用，也方便单独看某一页 |
| `plan.json` | 分页方案：每页类型、字数、警告 |

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--out DIR` | 输出目录 |
| `--theme NAME` | 皮肤名，默认 `default`（= **奶油蓝**）。内置 4 套：`奶油蓝`(默认) / `知识风` / `暗夜`(深色底) / `苔绿`。英文别名 `default` / `knowledge` / `dark` / `sage` 也认；也可指向 `assets/themes/` 下自建的 `<名字>.css` |
| `--frame NAME` | 配图边框风格，见下表。**不写 = 默认 `hairline`（细描边）** |
| `--max-chars N` | 每页目标容量（含图片折算的当量）。**不写就按卡片实际可用高度自动算**（默认皮肤约 345），一般不用管；页太空调大，页太挤调小 |
| `--title T` | 覆盖标题（一般不用，front-matter 里的优先） |
| `--text "..."` | 用户直接在对话里贴的稿子走这个，省得先落盘 |
| `--no-slides` | 只出 `cards.html` 预览，不生成单页 |

配图边框风格（`assets/frames/` 下的预设，中英文名都认，也可写进 front-matter 的 `frame:`）：

| 值 | 名字 | 效果 |
| --- | --- | --- |
| `hairline` / `细描边` / `a` | 细描边 | 8px 细线框住配图，边框色跟着皮肤分隔线走。**默认** |
| `paper` / `相纸框` / `c` | 相纸框 | 40px 粗边填卡片底色 + 投影，像照片贴在相纸上。浅色皮肤下是白框，深色皮肤（暗夜）下是同色厚框 |
| `none` / `无边框` | 无边框 | 配图光边贴版面 |

命令行 > front-matter > 默认值（`hairline`）。用户没说就默认细描边，**别自作主张换风格**——这是视觉决策，问一句比猜快。

要加新风格：往 `assets/frames/` 放一个只含那三个变量的 css，文件头部写好 `@frame-meta`（名字/别名/摘要），**代码零改动**。
同理，加新皮肤只需往 `assets/themes/` 放一个带 `@theme-meta` 头部的 css —— 别再去找代码里的别名表，那已经没有了。

### 第 2 步：确认

用 `present_files` 打开 `cards.html`。回复里要说清楚：

- 切成了几页，每页一句话概括
- 有没有「内容偏多可能溢出」的警告，有的话建议怎么处理
- 提醒用户：改稿、改 `theme.css`、或者让我调 `--max-chars` 都可以

### 第 3 步：HTML → PNG

```bash
node "$SKILL/scripts/render.mjs" <输出目录>/cards.html --out <输出目录>/png
```

产物是 `cards_01.png`… 每张 1080×1440，直接可发。渲染完用 `present_files` 把 PNG 全部列出来。

| 参数 | 说明 |
| --- | --- |
| `--out DIR` | PNG 输出目录，默认 `<html同级>/png` |
| `--only N` | 只重渲第 N 张（改了一页时用，省时间） |
| `--scale 2` | 出 2160×2880（一般不需要，1080 已够小红书） |
| `--engine playwright\|chrome-cli` | 强制指定引擎，排查问题时用 |
| `--chrome FILE` | 指定浏览器路径 |

渲染引擎优先用 Playwright（精确、支持逐元素截图），不可用时自动降级到 Chrome 命令行。降级模式下必须传 `slides/` 目录，不能传 `cards.html`：

```bash
node "$SKILL/scripts/render.mjs" <输出目录>/slides --out <输出目录>/png
```

## 稿件写法（讲给用户听）

支持标准 Markdown，另外几个约定值得记住：

| 写法 | 效果 |
| --- | --- |
| `# 一级标题` | **封面页**。紧随其后的一句引用或短句自动变成封面副标题 |
| `## 二级标题` | **另起一张卡**。小红书里一个 H2 就是一页，这是主要的分页方式 |
| `### 三级标题` | 页内小标题，不单独开页 |
| 单独一行的 `---` | **强制分页**，想在哪断就写在哪 |
| `> 引用` | 引用块（金色大字 + 竖条）。页面里只有它时自动变成金句卡 |
| `1.` / `-` 列表 | 有序列表自动加 01/02/03 序号 |
| `**加粗**` / `==高亮==` | 加粗 / 荧光笔高亮 |
| `![说明](图片.png)` | 插入本地图片，路径相对于稿件文件所在目录 |

页顶可以用 front-matter 配置：

```markdown
---
title: 文章标题
kicker: 工作方式        # 封面顶部那行小字
theme: 知识风           # 用哪套皮肤，不写就是奶油蓝（默认）
frame: hairline         # 配图边框风格：hairline / paper / none
maxChars: 345           # 每页目标容量，不写就自动算
footer: 我的账号名       # 底部信息条左侧文字。写完还不会显示——要把 theme.css 里的
                        # --foot-display 改成 flex 才会出现（右侧自动带 x/y 页码）
---
```

优先级：**命令行 > front-matter > 内置默认值**。

> `theme` / `maxChars` 这类字段不写就走默认，不需要留空占位。

更细的写作建议见 [references/authoring.md](references/authoring.md)。

## 自定义皮肤

用户说想改风格时，按这个顺序引导：

1. **首选调参台** —— 让用户用浏览器打开 `templates/theme-tuner.html`（必须保持在该目录下，它靠相对路径读样式）。
   顶部「从哪套皮肤起调」列的就是 `assets/themes/` 下真实存在的皮肤，点一下整套套用；下面是逐项滑杆/取色器，
   右边 4 张真实卡片实时变。调完点「复制配置」把结果贴回来，或点「下载 theme.css」。
   **导出的配置里，配图边框那三个变量是整段注释掉的**（它们归 `assets/frames/` 独占，写进皮肤会让边框色不再跟皮肤走）——
   这是刻意设计，不用当成 bug 去「修好」它。
2. **拿到配置后** —— 写入 `assets/themes/<目标皮肤>.css`（覆盖对应变量即可），或者另存一份 `assets/themes/<新名字>.css`，之后用 `--theme <新名字>` 调用。
   **新皮肤记得在文件头部写好 `@theme-meta`**（名字/别名/摘要/适用场景）—— 别名表和总览页都从这里读，写了才认得出。
3. **有参考图** —— 让用户发参考图或参考链接，照着提取配色和字号感，直接改目标皮肤的 css。
4. **高级用户** —— 直接改 `assets/themes/<皮肤>.css`（只有 12 行配色，每行都有中文注释）。
   `assets/base.css` 是「结构 + 所有皮肤共用的基准值」，改字号/间距/字体也是改那里，一般不用动结构部分。
5. **想换风格但拿不准** —— 先打开 `docs/gallery.html` 看 4 套皮肤 × 3 种边框的实际效果，再决定往哪个方向调。

**加/删皮肤或边框之后**，三样生成物都要刷新，否则 README 和调参台会开始骗人：

```bash
node scripts/build-tuner.mjs     # 调参台的皮肤/边框清单
node scripts/build-gallery.mjs   # docs/gallery.html
node scripts/build-preview.mjs   # docs/preview/*.png（跑完会反查 README 引用）
```

删除皮肤＝把 `assets/themes/<名字>.css` 移出目录（推荐移进 `assets/themes/_archive/`，留档可捞回）；
**别删 `frames/hairline.css`**，它是 `--frame` 的默认值。详见 [references/theming.md](references/theming.md)。

全部可调变量见 [references/theming.md](references/theming.md)。

### 调参台不会帮你检查对比度（重要）

用户从调参台导出的配色，**拿到后必须先自己看一眼对比度**，尤其这三组：

| 变量 | 用在什么元素上 | 出问题的后果 |
| --- | --- | --- |
| `--accent` | 列表序号、封面小标签、列表圆点、引用竖条 | 太浅 → 序号和小标签直接隐形 |
| `--ink-soft` | 封面副标题、页内小标题 | 太浅 → 封面那句副标题读不清 |
| `--mark-bg` | `==高亮==` 底色 | 太接近底色 → 高亮看不出 |
| `--mark-ink` | `==高亮==` 里的字色 | **深色皮肤必查**：不设时跟随 `--ink-strong`（近白），白字压亮黄只有 1.44:1，整块高亮等于没了 |

**判断标准**：强调色和卡片底色之间要能一眼区分。`--accent` 压在同明度的浅底上（比如淡蓝 `#cee1f0` 配奶油白 `#fcf9e6`）对比度只有 1.27:1，等于没写。实测下来 `--accent` 至少要 2.8:1 才够用，3:1 以上更稳。完整阈值表和验算命令见 [references/theming.md](references/theming.md#对比度自检)。

**遇到时不要闷头照搬**——先按原配置出一版图，把问题页发给用户看，再给一个加深版本作对比，让用户选。这是有效沟通，不是自作主张。

## 排版兜底逻辑（了解即可，不用讲给用户）

- **容量**：**按卡片实际可用高度自动算，不是固定字数**。公式 =（卡片高 − 上下留白 − 标题区）× 中文行容量 ÷ 单字高度；奶油蓝皮肤实测算出 **345**（`plan.json` 里的 `maxChars` + `auto: true` 就是这个值）。`--max-chars` 只在需要人工干预分页密度时才写。
  > 历史教训：早期写死 260，图多字少的稿子会被切成 6 页（260 字只花掉 832px，可用高度其实有 1108px）。别改回写死值。
  > 只把参数名留着不改的原因：`--max-chars` 是唯一的强制干预入口，删了用户就没法微调了。
- **合并**：标题下面几乎没有内容（正文不足 34 字）的「空壳页」会被相邻页吸收，避免出现空卡。
- **图文不拆**：配图在本页放不下时，会把紧挨在它前面的那段说明文字一起带到下一页。稿子里「说明文字 + `![]()`」本来就是连读的，拆开会出现「文字留在上页结尾、图孤零零出现在下页开头」。
- **居中**：内容填充不到 72% 的页自动垂直居中，不会出现正文全吊在顶部的尴尬。
- **溢出检测**：`cards.html` 里内置了检测脚本，任何一页内容超出 1440px 会在预览里标红并显示超出多少像素。**看到红色标记就要处理**——要么调小 `--max-chars`，要么拆分段落。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| **改了皮肤 css 但图没变** | CSS 是生成时**内联**进 HTML 的。改完皮肤必须重跑 `build-cards.mjs`，只重跑 `render.mjs` 不会生效 |
| 找不到浏览器 | 让用户装 Chrome，或跑 `npx playwright install chromium`，或 `--chrome` 指定路径 |
| 中文变成方块 / 丑字体 | 稿子没问题，是字体栈里的字体本机没装。改 `assets/base.css` 的 `--font-display` / `--font-body` 为 `"Microsoft YaHei"`（或在皮肤文件里覆盖同名变量） |
| **`--theme` 说认不出某套皮肤** | 皮肤文件头部的 `@theme-meta` 写漏了或格式不对（要 `@aliases: 名字1, 名字2`）。报错清单会列出脚本实际认到的可用皮肤，对着看 |
| 提示找不到图片 | 检查 `![]()` 里的相对路径是否相对**稿件文件**，且文件名大小写正确 |
| 某页被标红溢出 | 加 `---` 手动分页，或调小 `--max-chars`（比如 220） |
| 预览里卡片顺序不对 | 检查稿件里是否有孤立的一行 `---` 被当成强制分页 |
| 输出 PNG 是空白 | 图片路径写错导致卡住，看终端 `[warn] 找不到图片` 提示 |
| **看图觉得没居中 / 留白怪** | 别信肉眼——缩略图是等比缩放的，目测比例必错。用 Playwright 量 `boundingRect`：`card--airy` 的正常状态是内容中点 = `--card-h`/2、上留白 = 下留白 |
| **出图尺寸不是 1080×1440**（比如 1384） | 截图区域超视口被裁了。`render.mjs` 会自动把视口撑到整页高，并在落盘后校验尺寸，现在仍报错就是真有问题，别忽略 |
| Obsidian 笔记里的数字页码 | 全篇要有 2 个以上「单独一行的数字」才认，只写一个会被当正文。**认出来之后每个数字都是一次强制分页**——所以 Obsidian 里用 `1` `2` `3` 分段的笔记，导进来自然就是按段分页，不用再补 `---`。数字本身不会渲染到卡片上 |
| 封面标题末尾的 emoji / 短词被挤成孤零零一行 | `.card--cover .card__title` 上已加 `text-wrap: balance` 把各行宽度匀开。若匀完仍然难看，说明标题本身太长（超过约 18 个全角字就会到 4 行），考虑改短或调小 `--cover-size` |
| 稿子里的 `![[某某.html]]` / `.pdf` 没出现在卡片上 | 卡片只支持图片。这类嵌入会被**跳过**（终端有一行 `[ignore]` 清单，`plan.json` 里记在 `skippedEmbeds`），这是用户确认过的既定行为，不是 bug。要让它出现就先转成 PNG/JPG 再引用 |

## 目录结构

```
xhs-card-studio/
├── SKILL.md
├── scripts/
│   ├── build-cards.mjs     稿件 -> 分页 -> 卡片 HTML
│   ├── render.mjs          HTML -> PNG（Playwright / Chrome CLI）
│   ├── build-gallery.mjs   生成 docs/gallery.html（视觉模板总览）
│   ├── build-preview.mjs   生成 docs/preview/*.png（README 门面图）+ 反查 README 引用
│   ├── build-tuner.mjs     生成 templates/tuner-data.js（调参台的皮肤/边框清单）
│   └── lib/templates.mjs   皮肤/边框清单的唯一读取入口
├── assets/
│   ├── base.css            结构骨架 + 所有皮肤共用的基准值（别动结构）
│   ├── gallery-shell.css   总览页网页自身的配色（不影响出图）
│   ├── themes/             皮肤（只写配色）：default(奶油蓝) / 知识风 / 暗夜 / 苔绿
│   └── frames/             配图边框预设（独占 --img-border-*）：hairline / paper / none
├── templates/
│   ├── theme-tuner.html    可视化皮肤调参台
│   └── tuner-data.js       调参台读的皮肤/边框清单（**生成物**）
├── references/
│   ├── authoring.md        稿件写作规范
│   └── theming.md          挑皮肤 / 改皮肤 / 加皮肤 + 对比度自检
├── examples/
│   ├── demo-gallery.md     三页统一示意（皮肤与边框样张共用）
│   ├── demo-post.md        示例稿件（纯文字），可直接拿来试跑
│   ├── demo-figure.md      示例稿件（演示配图边框）
│   └── images/             示例配图
├── docs/
│   ├── gallery.html        视觉模板总览（**生成物**）
│   └── preview/            README 预览图（**生成物**，文件名 = theme-<slug>.png / page-*.png）
└── outputs/                默认输出位置
```

> 改了皮肤/边框之后，三个**生成物**都要重跑（顺序无所谓）：
> ```bash
> node scripts/build-tuner.mjs     # 调参台的皮肤/边框清单
> node scripts/build-gallery.mjs   # docs/gallery.html
> node scripts/build-preview.mjs   # docs/preview/*.png
> ```
> 别手工替换 README 的图 —— 历史上就是这么出现过「3 张旧皮肤 + 1 张新皮肤」混在一行里的。
> `build-preview.mjs` 跑完会反查 README：引用的图不存在就**直接报错退出**，alt 与皮肤对不上会告警。
