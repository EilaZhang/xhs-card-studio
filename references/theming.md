# 皮肤变量字典

所有可调项都在 `assets/themes/<皮肤名>.css` 里，**全部是 CSS 变量**。
`assets/base.css` 只负责结构，不要动它。

当前内置两套：**`default.css`（奶油蓝，默认）** 和 `知识风.css`（白底红强调，2026-09-15 之前的默认）。
换皮肤用 `--theme 奶油蓝` / `--theme 知识风`，不写就是奶油蓝。

改完直接重新跑 `build-cards.mjs` 就生效。

> 不想碰代码：打开 `templates/theme-tuner.html`，拖滑杆选颜色，右边实时看，调完复制配置。

## 画布

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `--card-w` | `1080px` | 卡片宽，小红书标准，别改 |
| `--card-h` | `1440px` | 卡片高，3:4，别改 |

## 配色

| 变量 | 默认（奶油蓝） | 说明 |
| --- | --- | --- |
| `--card-bg` | `#fcf9e6` | 卡片底色（奶油黄） |
| `--stage-bg` | `#eef3f7` | 预览页背景，不会出现在图里 |
| `--ink-strong` | `#212121` | 最重的字：标题 |
| `--ink` | `#212121` | 正文 |
| `--ink-soft` | `#7d9fbf` | 次要文字、封面副标题 |
| `--ink-faint` | `#bcd0e2` | 最浅：图片说明 |
| `--accent` | `#6b9bc7` | 强调色：序号、小标签、列表圆点、引用竖条 |
| `--accent-soft` | `#e5f0f6` | 强调浅色，链接下划线 |
| `--mark-bg` | `#c6dcf2` | `==高亮==` 的底色 |
| `--quote-bg` | `#c6dcf2` | 引用块、图片占位底色 |
| `--divider` | `#a5c0db` | 分隔线 |
| `--card-shadow` | 一层柔和投影 | 预览用，图里看不到 |

> 本表的「默认」= `assets/themes/default.css`。另一套 `知识风.css`（白底 `#ffffff` + 红强调 `#d9483b`，即 2026-09-15 之前的默认皮肤）值就在该文件里，用 `--theme 知识风` 调用。**改配色前先确认自己在改哪一套。**

配色思路：**一个强调色用到底**。强调色别超过一个，多了就乱。

### 对比度自检

调参台只负责把颜色贴上去，**不会替你判断能不能看清**。导出配色后先过一遍：

| 检查项 | 参考阈值 | 出问题时的表现 |
| --- | --- | --- |
| `--accent` vs `--card-bg` | ≥ 3:1 | 序号、小标签、引用竖条「像没印上去」 |
| `--ink-soft` vs `--card-bg` | ≥ 4.5:1（大字 ≥ 3:1） | 封面副标题发虚、读起来费劲 |
| `--ink` vs `--card-bg` | ≥ 7:1 | 正文发灰，长时间阅读累 |

`--divider`、`--ink-faint` 是装饰性的（分隔线、图注），低于 2:1 也正常，不用管。

**踩过的坑（奶油蓝皮肤）**：奶油黄底 `#fcf9e6` 配淡蓝强调色，实测对比度如下——

| 变量 | 原值 | 对比度 | 修正后 | 对比度 |
| --- | --- | --- | --- | --- |
| `--accent` | `#cee1f0` | **1.27:1** | `#6b9bc7` | 2.78:1 |
| `--ink-soft` | `#a5c0db` | 1.78:1 | `#7d9fbf` | 2.62:1 |
| `--ink` | `#212121` | 15.21:1 | — | — |

原文案里 `--accent` 的 1.27:1 意味着序号**印上去等于没印**：缩略图里还能看到一点颜色，导出成图后直接消失。修正后 2.78:1，虽未满 3:1，但因为序号和小标签都是 24px 以上的粗体大字，实测已经能一眼看清，且冷调气质保持不变。**若要达标，最小改动是 `#6494c0`（3.03:1，几乎看不出差别），想更稳可用 `#5a8ab8`（3.44:1）。**

> `--accent` 是**功能性颜色**，不是装饰色——它管着序号、小标签、列表圆点、引用竖条四样东西。宁深勿浅。
> 拿不准时，改完重新出一版图，和原配置并排看，让用户选。别闷头照搬用户导出的值。

算对比度（改完皮肤可以自己验一遍）：

```bash
node -e "
const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const hex=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const L=h=>{const[r,g,b]=hex(h).map(lin);return 0.2126*r+0.7152*g+0.0722*b};
const R=(a,b)=>{const x=L(a),y=L(b),[hi,lo]=x>y?[x,y]:[y,x];return ((hi+0.05)/(lo+0.05)).toFixed(2)};
console.log(R('#6b9bc7','#fcf9e6'));
"
```

## 字体

| 变量 | 说明 |
| --- | --- |
| `--font-display` | 标题字体 |
| `--font-body` | 正文字体 |

**只能用本机装了的字体**，否则静默降级成难看的默认字体。Windows 安全牌：

```css
"Microsoft YaHei"   /* 微软雅黑，最稳 */
"DengXian"          /* 等线 */
"SimHei"            /* 黑体 */
"SimSun"            /* 宋体，衬线感 */
"FangSong"          /* 仿宋 */
"KaiTi"             /* 楷体 */
```

想用思源黑体 / 思源宋体，得先自己装字体，再写：

```css
--font-display: "Source Han Serif SC", "Noto Serif CJK SC", serif;
```

标题和正文想做出对比，可以一个用衬线一个用无衬线：

```css
--font-display: "SimSun", serif;
--font-body: "Microsoft YaHei", sans-serif;
```

## 字号

画布宽 1080px，**别拿网页字号来想象**。正文 40px 才是舒服的阅读尺寸。

| 变量 | 默认 | 建议区间 |
| --- | --- | --- |
| `--cover-size` | `96px` | 64～132 |
| `--title-size` | `62px` | 44～84 |
| `--body-size` | `40px` | 28～56 |
| `--quote-size` | `52px` | 36～76 |
| `--kicker-size` | `24px` | 16～34 |
| `--title-weight` | `800` | 600～900 |
| `--body-weight` | `400` | 300～500 |

字号调大能塞的字就变少，记得同步调 `--max-chars`。
经验值：正文每加 4px，`--max-chars` 减 30 左右。

## 间距

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `--pad-x` | `96px` | 左右留白。想更松弛调到 120+ |
| `--pad-y` | `104px` | 上下留白 |
| `--gap-head` | `44px` | 标题区与正文区的距离 |
| `--gap-body` | `0px` | 正文区上方额外留白 |
| `--gap-block` | `36px` | 段落之间 |
| `--li-gap` | `20px` | 列表项之间 |
| `--li-indent` | `1.5em` | 列表缩进 |
| `--body-leading` | `1.78` | 正文行高。1.6 紧凑，2.0 疏朗 |
| `--body-tracking` | `0.01em` | 正文字距 |

## 细节

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `--radius` | `24px` | 圆角。0 = 硬朗，40+ = 柔和 |
| `--quote-pad-x` | `44px` | 引用块左右内边距 |
| `--quote-pad-y` | `40px` | 引用块上下内边距 |
| `--quote-bar` | `12px` | 引用块左侧竖条粗细。0 = 不要竖条 |
| `--img-max-h` | `720px` | 单张配图最大高度 |
| `--img-border-w` | `8px` | 配图边框粗细。0 = 不要边框 |
| `--img-border-color` | `#dfe4ea` | 配图边框颜色 |
| `--img-shadow` | `none` | 配图投影，例 `0 14px 34px rgba(23,32,45,.18)` |
| `--cover-sub-gap` | `44px` | 封面主标题与副标题的距离 |

### 配图边框怎么调

**首选方式：用边框预设，不改变量。**

边框风格单独放在 `assets/frames/` 目录，出图时一行参数切换，不动皮肤：

```bash
node scripts/build-cards.mjs 稿件.md --frame paper     # 相纸白框
node scripts/build-cards.mjs 稿件.md --frame none      # 不要边框
node scripts/build-cards.mjs 稿件.md                   # 不写 = 皮肤默认（细描边）
```

也可以在稿件 front-matter 里写 `frame: paper`，整个稿子固定用这个风格。**命令行 > front-matter > 皮肤默认值**。

| 预设文件 | `--frame` 可用值 | 效果 |
| --- | --- | --- |
| `frames/hairline.css` | `hairline` / `细描边` / `a` | 8px 细线，边框色取 `--divider` |
| `frames/paper.css` | `paper` / `相纸白框` / `c` | 40px 粗边填 `--card-bg` + 投影 |
| `frames/none.css` | `none` / `无边框` | 0px，光边 |

**调参台**里「配图边框（一键切换）」那组按钮，点一下就是这三个预设，实时预览。

> **从调参台导出配置时，`--img-border-color` 的语义引用会保留**（导出成 `var(--divider)` / `var(--card-bg)`，
> 不是解析后的 hex）。这样你把导出的配置写进皮肤后，边框色仍会跟着分隔线/底色同步。
> 手动调过颜色（不等于这两个变量的当前值）则原样导出 hex —— 这是 2026-09-15 实测修掉的坑，
> 修之前导出会把 `var(--divider)` 拍平成 `#a5c0db`，换皮肤时边框色就不同步了。

#### 三个底层变量

预设文件里其实就设了这三个变量，想微调就直接改（皮肤文件里也有同名默认值，会被 `--frame` 覆盖）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `--img-border-w` | `8px` | 边框粗细，`0` = 无边框。0~12 = 细线，16~24 = 画框，36~48 = 相纸白边 |
| `--img-border-color` | `var(--divider)` | 边框颜色。写成 `var(--card-bg)` 就是相纸白框 |
| `--img-shadow` | `none` | 投影，例 `0 14px 34px rgba(23,32,45,.18)` |

用 `var()` 引用皮肤变量，换皮肤时边框会自动跟着适配，不用改两份。**注意**：`getComputedStyle` 读到的是解析后的色值，不是 `var(...)` 字符串——这是 CSS 自定义属性的规范行为，别以为是 bug。

**加一种新风格**：往 `assets/frames/` 放一个只含这三个变量的 css，再到 `scripts/build-cards.mjs` 的 `FRAME_ALIASES` 里加一行名字映射（中英文别名都能加）。

#### 两个必须知道的点

- **边框会占配图自身的宽高**（全局 `box-sizing: border-box`）。粗边框（相纸白框那种）让图变小、占地变大，可能把本来同页的内容挤到下一页——分页器已经把边框宽度算进权重了，所以**只会换页，不会溢出**。
- 边框画在图片内容外，圆角会跟着走，不用额外设置。


## 底部信息条（默认关闭）

想显示账号名 / 页码：

```css
--foot-display: flex;
```

然后在稿件 front-matter 里写：

```markdown
---
footer: 我的账号名
---
```

页码用 `{PAGE}` `{TOTAL}` 占位，脚本会自动替换。

## 新建一套皮肤

```bash
cd ~/.workbuddy/skills/xhs-card-studio/assets/themes
cp default.css 清晨蓝.css        # 文件名就是皮肤名（不带 .css），中英文都行
```

改完用皮肤名调用（不带 `.css`）：

```bash
$NODE scripts/build-cards.mjs 稿件.md --theme 清晨蓝
```

或者让稿件自己记住：

```markdown
---
theme: 清晨蓝
---
```

**要不要加别名？** 文件名本身就能直接用，只有想让它更好认（或想给中文名配个英文写法）时才需要：
在 `build-cards.mjs` 的 `THEME_ALIASES` 里加一行 `清晨蓝: '清晨蓝', morning: '清晨蓝'`，
再在 `THEME_LABELS` 里加个给人看的名字。**内置两套皮肤就是这么管理的**——
`default.css`（奶油蓝）和 `知识风.css` 是文件真名，`奶油蓝` / `干净知识风` 都是别名。

> 内置皮肤改名前一定要把 `THEME_ALIASES`、`THEME_LABELS`、SKILL.md、本文件一起改，
> 漏掉任何一处，用户报「找不到皮肤」时你会找不到原因。

## 深色底皮肤怎么调

内置的两套皮肤**都是浅色底**（奶油黄 / 白），没有深色底预设。要自己做一套：

`--stage-bg` 和 `--card-shadow` 可以不动（它们只影响预览）。
但深色底上 `--mark-bg` 高亮色要换成亮色（比如 `#f2c94c`），否则看不见。
