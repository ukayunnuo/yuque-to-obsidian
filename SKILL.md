---
name: yuque-to-obsidian
description: Use when the user wants to mirror a Yuque (语雀) knowledge base into an Obsidian vault or a local Markdown folder and keep it in sync — pull with yuque-dl, repair missing images, strip the random _id suffix from filenames, number duplicate titles, add frontmatter and callouts, generate index.md, and optionally register a daily scheduled run. Triggers include 语雀导入 Obsidian, 语雀同步到 Obsidian, 把语雀笔记搬到 Obsidian, 语雀知识库备份到本地, 语雀导出 markdown, 语雀自动同步, 语雀迁移, "yuque to obsidian", "export yuque markdown", "backup yuque notes". Also use when the user only says they used to keep notes in Yuque and now use Obsidian.
license: MIT
---

# 语雀 → Obsidian 单向同步

把语雀知识库变成一个持续更新的 Obsidian 目录。这不是"导出一次"，而是**单向镜像**：语雀是唯一真源，Obsidian 那一份只读。

## 先判断：这是不是本技能的活

- 是：用户要把语雀笔记放到 Obsidian / 本地 Markdown，并且以后还要跟着语雀更新
- 是：用户已有一批 yuque-dl 导出物，想批量改名、修图片链接、加 frontmatter
- 不是：反向需求（Obsidian 写完发到语雀），那是发布类插件
- 不是：只想导出一两篇，让用户用语雀网页自带导出即可

## 硬前提

1. **Node ≥ 18**（脚本用了内置 fetch）
2. **yuque-dl**：`npm i -g yuque-dl`。这是目前最可靠的正文拉取工具，不要自己造 API 爬虫
3. **访问凭据**（三选一，问用户要，不要自己假设哪种）：
   - 私密库 → `_yuque_session` cookie（免费账号没有 API Token，只能走 cookie）
   - 公开但带密码的库 → 库的访问密码（配置里的 `password`）
   - 完全公开的库 → 什么都不用给
   - 企业版语雀的 cookie 名不叫 `_yuque_session`，用配置里的 `cookieKey` 覆盖

开工前先真验一遍再说话：`node -v`（≥18）、`yuque-dl --version`、以及用户给的 vault 路径确实存在。

## 本技能不含任何用户配置

技能目录里只有流程和脚本。**下面每一项都必须由用户当场提供**，缺哪个问哪个——不要替用户猜，也不要用示例值凑数（猜错的 vault 路径或账号 slug 会直接写进真实目录）：

| 要向用户收集 | 怎么问 | 不要做什么 |
|---|---|---|
| Vault 绝对路径 | "Obsidian 库（有 `.obsidian` 的那个文件夹）完整路径？" | 不要自己编一个路径，也不要假设它在用户主目录 |
| 要同步哪些库 | 先跑 `--list-books`，把清单给用户点名 | 不要默认全同步，私密库里常有工作内容 |
| 凭据 | 见第 1 步的取法 | 不要回显到聊天、不要写进日志或 git |
| 落进 vault 的目录名 | 默认用知识库原名，让用户确认可改 | 改名会换掉 staging 子目录，等于整库重下，要先讲清代价 |
| 每天几点同步（要定时才问） | "每天几点跑？" | 不要不问就把 09:00 写进计划任务 |

下文中 `<vault 路径>`、`<配置路径>`、`<skill>` 这类尖括号都是待填值，`<skill>` 指本技能目录的绝对路径。

## 工作流

### 1. 拿到凭据

让用户自己在浏览器里取，不要代登录，也不要让用户把账号密码发到对话里：

> 登录语雀 → F12 → **Application（应用）** → Cookies → `https://www.yuque.com` → 复制 `_yuque_session` 的值

拿到后**只写进本地配置文件**：不回显到聊天、不写进日志、不提交到 git。它等价于登录态，通常几周后过期；过期时同步会报"认证失败"，让用户重取一次。

用户不肯给 cookie 时的退路（三件事都要说清，别只说"也行"）：

- **私密库必须给 cookie**，没有替代方案——免费账号没有 API Token
- **公开库可以不登录，但要跳过第 2 步**：`--list-books` 查的是"我的库"，没有登录态一定失败。让用户直接把知识库 URL 给你，写进 `repos`
- **公开库不给 cookie 就意味着补图失效**：拿不到 `book_id`，`docImages` 会返回空，图片只能靠 yuque-dl 自己下（它本来就会漏）

注意：yuque-dl 用命令行参数接 token，同机其它账户在进程列表里看得到。共享机器上提醒用户，或在一次性同步后清 shell 历史。

### 2. 枚举知识库，让用户挑

先写最小配置：`--list-books` **只需要 `session`**（`vault` 可以先不写，路径还没定也能先列库）；正式同步才必须有 `vault`。然后：

```bash
node "<skill>/scripts/sync.mjs" --config="<配置路径>" --list-books
```

输出形如 `名称  slug  31 篇  私密`。把表交给用户点名要哪几个库——**不要默认全同步**。

公开库没有登录态时这步跑不通，按第 1 步的退路直接要 URL。

### 3. 写配置

```json
{
  "session": "<用户给的 _yuque_session>",
  "vault": "<vault 路径>",
  "incremental": true,
  "repos": [
    { "url": "https://www.yuque.com/<账号>/<slug>", "name": "<vault 里的目录名>" }
  ]
}
```

可选字段：

| 字段 | 默认 | 用途 |
|---|---|---|
| `cookieKey` | `_yuque_session` | 企业版语雀的 cookie 名不同，改这里 |
| `password` | 无 | 公开带密码的库 |
| `staging` | `%LOCALAPPDATA%\yuque-to-obsidian\staging-<hash>`（非 Windows 落 `~/.cache`） | 原始下载缓存，**刻意放在 vault 之外** |
| `incremental` | `true` | 增量下载 |

把配置放在 `<vault>/.yuque-sync/yuque-sync.config.json`，和笔记同源、好找；`.yuque-sync` 是点目录，Obsidian 不显示。staging 不放进 vault，是为了避免几十 MB 原始下载被 OneDrive / iCloud 反复同步。

**如果 vault 在 git 仓库里（必须问）**：把 `.yuque-sync/` 加进 vault 自己的 `.gitignore`。技能自带的 `.gitignore` 只保护技能目录，管不到你 vault 里那份配置——而那份配置里就是登录态。

完整字段说明见 `README.md`。

### 4. 首次同步 + 校验

```bash
node "<skill>/scripts/sync.mjs" --config="<配置路径>"
node "<skill>/scripts/check.mjs" --config="<配置路径>"
```

`sync.mjs` 末尾会打印 `RESULT {...}`（含 `ok`、`docs`、各库明细）。`check.mjs` 每行是 `库名 / md 数 / 图片引用数 / 断裂数 / 体积`。**断裂数不为 0 就别交付**，去 `references/gotchas.md` 的图片一节排。

两个语义边界别搞错：

- `check.mjs` 只统计 `](./img/...)` 这类相对引用。外链图（CSDN 等）永远不计入，所以 `broken 0` **不等于图片全好**，外链图要抽查
- 产物位置：每库一个 `index.md`，vault 根一份 `_同步状态.md`，`sync.log` 记在配置所在目录

### 5. 定时（用户明确要"自动同步"时才做）

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File "<skill>\scripts\install-task.ps1" -ConfigPath "<配置路径>" -Time <HH:mm>
```

它会先写一个 `sync-yuque.bat` 再注册 `schtasks`，任务只依赖这个 bat，不依赖 skill 目录位置。注册后回读确认：`schtasks /query /tn <任务名> /v /fo LIST` 里"要运行的任务"必须是正确路径——路径写错是这类任务最常见的静默失败。

macOS / Linux 不要用这个脚本，直接给计划任务：

```cron
# 每天 09:00；Node 用 which node 的实际路径
0 9 * * * /usr/local/bin/node "<skill>/scripts/sync.mjs" --config="<配置路径>" >> "<配置路径所在目录>/sync.out.log" 2>&1
```

launchd 用 `StartCalendarInterval` 起同一条命令即可。

### 6. 用户已经有 yuque-dl 导出物时

不重下。把配置里的 `staging` 指到那份产物所在目录（里面要有各库的 `progress.json`），然后只跑发布：

```bash
node "<skill>/scripts/sync.mjs" --config="<配置路径>" --publish-only
```

改名、重名编号、frontmatter、callout、index.md 一样生效。若用户手上是别的工具导出的纯 Markdown（没有 `progress.json`），先说明本技能按 yuque-dl 的目录结构工作，要么重下、要么手工整理。

### 7. 交付时讲清三件事

1. **单向镜像**：在 Obsidian 里改这个目录，下次同步会被覆盖；用户自己的笔记写别处
2. **cookie 会过期**：状态文件出现"认证失败"就重取一次
3. **画板 / 思维导图 / 数据表会降级**：语雀私有格式，任何工具都还原不了，让用户抽查几篇复杂文档

## 脚本

| 文件 | 作用 |
|---|---|
| `scripts/sync.mjs` | 主流程：拉取 → 补图 → 发布。`--list-books` 枚举、`--only=<slug>` 单库、`--publish-only` 只重发布不下载 |
| `scripts/check.mjs` | 校验图片引用是否都能落到磁盘，按库汇总 |
| `scripts/install-task.ps1` | Windows 计划任务注册（bat 用绝对 node 路径，UTF-8 兼容中文路径）；`-DryRun` 只生成不注册，`-Remove` 卸载 |

改完发布规则（命名、frontmatter、callout）后，用 `--publish-only` 快速重刷，不用重新下载。

## 为什么长这样（改之前先读）

- **为什么要有 staging**：yuque-dl 的目录/文件名（`标题_随机id.md`）必须保持稳定，增量比对才准。所以分成两层：staging 原样保留，vault 里放清洗后的副本。直接动 staging 会让每次同步都重下整个库。
- **为什么图片要单独补**：yuque-dl 会漏图，而且它按"笔记所在目录"放图。补图必须走文档 API 拿原图地址，再写到**相对笔记的同一位置**，否则 Obsidian 里的相对链接指空。
- **为什么发布跳过未变文件**：每次重写全库会让 OneDrive / 坚果云重传几百个文件、版本历史爆炸。日志里的 `写入 / 未变` 就是给用户看的证据。
- **为什么清理前要判空**：`--publish-only` 在没有 staging 时会产生空 plan，照常清理会把整个库删光。`plan` 为空就跳过清理，这条护栏别拆。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| `认证失败：_yuque_session 可能已过期` | cookie 过期，让用户重取 |
| `读取知识库列表失败` | 同上；cookie 是新的则可能语雀接口改版，见 `references/api.md` |
| `找不到 yuque-dl` | 没装或不在 PATH：`npm i -g yuque-dl` |
| `找不到配置文件` | `--config` 用了相对路径但 cwd 不对，改绝对路径 |
| 图片断裂数 > 0 | 见 `references/gotchas.md` 的图片一节，多数是外链图需要按域名带 referer |
| 同步后笔记没更新 | yuque-dl 的 `progress.json` 认为没变；删 staging 下该库目录重下 |
| 日志出现 `⚠ N 篇在 staging 里找不到源文件` | progress.json 与 staging 目录不一致（语雀侧改过标题/目录）；删 staging 下该库目录重下 |
| 计划任务不跑 | 路径含中文/空格没引号；任务默认"仅登录时运行"；`schtasks /change` 要密码，直接 `/create /f` 重建 |

## 参考

- `README.md` — 安装、配置全字段、定时任务、隐私与卸载
- `references/gotchas.md` — 语雀格式陷阱、图片、云盘、命名边角
- `references/api.md` — 用到的语雀内部接口与调试方法
- `evals/evals.json` — 典型请求的验收口径
