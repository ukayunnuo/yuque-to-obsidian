# yuque-to-obsidian

把语雀（Yuque）知识库**单向镜像**成本地 Markdown / Obsidian vault 的 agent skill。

语雀是唯一真源，本地那份只读：每次同步把语雀的增删改搬过来，本地手改会被覆盖。

## 特性

- 用 [yuque-dl](https://github.com/yuque-dl/yuque-dl) 拉正文，不自己造爬虫
- 补齐 yuque-dl 漏掉的图片，补到**笔记所在目录**，保持相对链接有效
- 去掉文件名里的 _随机id 后缀，标题里的非法字符替换成 _
- 重名（含只差大小写）按 slug 顺序确定性编号，不会每次跳号
- 加 YAML frontmatter（原文标题 / 更新时间 / 原文地址），:: : 块转 Obsidian callout
- 每库生成 index.md 目录页，vault 根写 _同步状态.md
- 内容没变的文件不重写，对 OneDrive / 坚果云 / iCloud 友好
- 可选：Windows 计划任务每天自动同步

## 依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 18 | 脚本用了内置 fetch |
| yuque-dl | 1.0.x | npm i -g yuque-dl |
| Obsidian | 任意 | 可选；输出就是普通 Markdown 目录 |

## 安装

把整个 yuque-to-obsidian/ 目录放进你的 agent 技能目录，例如：

- Claude Code：~/.claude/skills/yuque-to-obsidian/
- 跨运行时通用别名：~/.agents/skills/yuque-to-obsidian/

之后对它说「把语雀的 X 知识库同步到 Obsidian」即可触发。

## 需要你自己准备的信息

本技能不附带任何个人配置。下面这些值都由你当场提供，agent 应当逐项问你，而不是替你猜：

| 值 | 从哪来 |
|---|---|
| Obsidian vault 的绝对路径 | 有 .obsidian 的那个文件夹 |
| 要同步哪些知识库 | 先跑 --list-books 看清单，再点名 |
| _yuque_session cookie | 登录语雀 → F12 → Application → Cookies → https://www.yuque.com |
| 每天几点同步（可选） | 你自己定 |

_yuque_session 等价于登录态：只写进本地配置文件，不要提交、不要贴到聊天里。

## 快速开始

1. 写一个最小配置，放到 <vault>/.yuque-sync/yuque-sync.config.json（列库阶段只需要 session；公开库不登录就跳过第 2 步，直接把 URL 写进 repos）：

   { "session": "<你的 _yuque_session>", "vault": "<vault 绝对路径>" }

2. 看有哪些库（名称 / slug / 篇数 / 公开或私密）：

   node "<skill>/scripts/sync.mjs" --config="<vault>/.yuque-sync/yuque-sync.config.json" --list-books

3. 把选中的库写进 repos，再正式同步：

   node "<skill>/scripts/sync.mjs" --config="<vault>/.yuque-sync/yuque-sync.config.json"

4. 校验：断裂数必须为 0

   node "<skill>/scripts/check.mjs" --config="<vault>/.yuque-sync/yuque-sync.config.json"

## 配置字段

    {
      "session": "<可选> _yuque_session 的值",
      "cookieKey": "_yuque_session",
      "password": "<可选> 公开带密码知识库的访问密码",
      "vault": "<必填> vault 绝对路径",
      "staging": "<可选> 原始下载缓存目录",
      "incremental": true,
      "repos": [
        { "url": "https://www.yuque.com/<账号>/<slug>", "name": "<vault 里的目录名>" }
      ]
    }

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| vault | 同步时必填 | — | 输出根目录；每个库在其下建同名子目录。`--list-books` 可省略 |
| repos | 是 | — | url 是知识库地址；name 省略时用知识库原名 |
| session | 否 | 空 | 私密库必需；公开库可留空 |
| cookieKey | 否 | _yuque_session | 企业版语雀的 cookie 名可能不同 |
| password | 否 | 空 | 公开但设了访问密码的知识库 |
| staging | 否 | %LOCALAPPDATA%/yuque-to-obsidian/staging-<hash>（非 Windows 落 ~/.cache） | 原始下载缓存。**不要放进 vault**，否则云盘会反复同步几十 MB 中间产物 |
| incremental | 否 | true | 传给 yuque-dl 的 --incremental |

配置建议放在 <vault>/.yuque-sync/yuque-sync.config.json：点目录 Obsidian 不显示，和笔记同源好找。

## 命令行

    node scripts/sync.mjs --config=<path>                 # 拉取 + 补图 + 发布
    node scripts/sync.mjs --config=<path> --list-books    # 只列知识库
    node scripts/sync.mjs --config=<path> --only=<slug>   # 只同步一个库
    node scripts/sync.mjs --config=<path> --publish-only  # 只重发布，不下载
    node scripts/check.mjs --config=<path>                # 校验图片引用

sync.mjs 结尾打印机器可读摘要：RESULT {"ok":true,"docs":123,...}。

## 定时同步

**Windows**（bat 里用 node 的绝对路径，兼容中文路径）：

    powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1 -ConfigPath "<vault>/.yuque-sync/yuque-sync.config.json" -Time 09:00 -TaskName YuqueSync_Obsidian
    # 只生成 bat、不注册任务（先验证路径）
    powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1 -ConfigPath "<同上>" -DryRun
    # 卸载
    powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1 -ConfigPath <同上> -Remove -TaskName YuqueSync_Obsidian

注册后一定回读：schtasks /query /tn YuqueSync_Obsidian /v /fo LIST，「要运行的任务」必须是正确路径。

**macOS / Linux**：

    0 9 * * * /usr/local/bin/node "<skill>/scripts/sync.mjs" --config="<vault>/.yuque-sync/yuque-sync.config.json" >> "<vault>/.yuque-sync/sync.out.log" 2>&1

## 隐私与安全

- _yuque_session 是登录态，泄露等于交出账号。仓库自带的 .gitignore 只保护**技能目录**；配置是写在你的 vault 里的，所以**如果 vault 本身是 git 仓库，请自己在 vault 的 .gitignore 里加一行 `.yuque-sync/`**。
- yuque-dl 用命令行参数接 token，同机其他账户在进程列表里能看到。共享机器上优先用公开库，或同步后清 shell 历史。
- 同步下来的笔记在本地是明文。同步前确认知识库里没有你不希望落盘的内容。
- 本技能调用的是语雀网页端自用接口（见 references/api.md），不是官方开放 API。接口可能随时改版，也请自行确认使用方式符合你所同意的服务条款。

## 排错

见 [references/gotchas.md](references/gotchas.md)，覆盖图片防盗链、重名、Lake 格式、云盘、计划任务。

## 目录结构

    yuque-to-obsidian/
    ├── SKILL.md                 # agent 读的主流程
    ├── README.md                # 本文件
    ├── LICENSE
    ├── .gitignore
    ├── references/
    │   ├── api.md               # 用到的语雀接口
    │   └── gotchas.md           # 踩过的坑
    ├── scripts/
    │   ├── sync.mjs             # 拉取 → 补图 → 发布
    │   ├── check.mjs            # 图片链接校验
    │   └── install-task.ps1     # Windows 计划任务
    └── evals/
        └── evals.json           # 典型请求与验收口径

## 开发自检

改完脚本后至少跑：

    node --check scripts/sync.mjs && node --check scripts/check.mjs
    node scripts/sync.mjs --config=/nonexistent    # 应打印找不到配置文件并 exit 2

## 许可证

MIT，见 [LICENSE](LICENSE)。
