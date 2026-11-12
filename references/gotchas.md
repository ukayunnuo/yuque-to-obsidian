# 语雀 → Obsidian 迁移的坑

按「会不会真的踩到」排序，每条都给出处理方式。

## 1. 免费账号没有 API Token

语雀的个人访问令牌需要会员。免费账号只能走网页 cookie：

- cookie 名：`_yuque_session`（企业版可能不同，配置里用 `cookieKey` 覆盖）
- 位置：F12 → Application → Cookies → `https://www.yuque.com`
- 有效期：通常几周，过期后接口返回 401

脚本里所有请求都带这个 cookie。不要把 cookie 写进脚本、日志或 git。

## 2. yuque-dl 的目录与命名

它产出的是 `标题_随机id.md` 和 `目录_随机id/`，因为语雀允许同名文档，唯一 id 是去重依据。

**不要在 staging 里改名**：yuque-dl 的 `progress.json` 按路径记缓存，改名会让下次同步重新下载整个库。改名只在「发布」这一步做，vault 里才是干净的。

## 3. 图片的几个独立问题

这三件事经常被混为一谈，实际上是三件：

**(a) 图片按笔记所在目录存放**。语雀的图片是「目录级」的：某篇笔记在 `A/B.md`，它的图在 `A/img/<docid>/x.png`，笔记里写的是相对路径 `./img/<docid>/x.png`。所以：

- 校验链接时必须相对**笔记所在目录**解析，相对库根解析会得出错误结论
- 补图也要补到笔记所在目录，补到库根会让链接指空

**(b) yuque-dl 会漏图**。正文里块级引用、表格内的图片经常漏。补图的正确来源是文档 API 的 `mode=markdown` 正文（见 `api.md`），不是抓页面 HTML——页面只有 `og:image` 一张。

**(c) 外链图有防盗链**。用户从 CSDN 复制进语雀的图，URL 是 `i-blog.csdnimg.cn`：

- 不带 referer：200
- 带 `referer: https://blog.csdn.net/`：200
- 带别的 referer（比如 `https://www.cnblogs.com/`）：403

所以**不要对所有图片统一加 referer**。脚本的规则是：`cdn.nlark.com` 才带 `https://www.yuque.com/`，其它域名不加。

补图时按文件名匹配：本地名是 `<原文件名>-<随机数>.png`，CDN 名是 `<原文件名>.png`，去掉尾部 `-\d+` 再比。文档里图片顺序与 API 正文顺序一致，数量相同时可以按顺序兜底。

## 4. Lake 格式无法还原

语雀新版文档是私有的 Lake 格式。经过 yuque-dl / 文档 API 转 Markdown 后：

- 画板 → 一张静态图
- 思维导图 → 一张静态图或丢失
- 数据表 → 表格或文本
- 折叠块、分栏 → 拉平

这是语雀的限制，换任何工具都一样。交付时让用户抽查几篇复杂文档，别承诺「完美迁移」。

## 5. 重名（包括只差大小写）

语雀里可以有两篇 `CentOS7安装MySQL服务` 和 `Centos7安装MySQL服务`。Windows 文件系统不区分大小写，直接落地会互相覆盖。

发布时按小写做去重键，第二个变 `... (2).md`。编号要**确定性**：按 slug 排序分配，否则每次同步编号都会跳。

标题里的 `/ : * ? " < > |` 要替换成 `_`，否则 Windows 建不出文件。

## 6. 云盘（OneDrive / iCloud / 坚果云）

- **staging 不要放 vault 里**。几百 MB 原始下载每天变动，云盘会反复上传。默认放 `%LOCALAPPDATA%/yuque-to-obsidian/`。
- **发布要跳过未变文件**。整库重写会让云盘重传全部文件、版本历史爆炸。日志里「写入 0 / 未变 N」就是证据。
- 镜像目录别在 Obsidian 里改；云盘产生 `xxx-副本.md` 直接删，下次同步会重建。

## 7. Windows 计划任务

- `schtasks /change` 修改 `/tr` 会要求输入账户密码 → 直接 `/delete` + `/create /f` 重建更省事
- 路径含中文/空格必须整段加引号，否则任务「创建成功」但从未运行
- **bat 的编码要配中文路径**：用 ANSI/ASCII 写含有中文的路径，字符会被替换成 `?`，任务永远失败且没有报错。脚本写的是 UTF-8 无 BOM + 首行 `chcp 65001`
- **计划任务里的 PATH 和你终端里不一样**：bat 里必须用 `node` 的绝对路径，否则「找不到 node」
- 默认是「仅登录时运行」；要无人值守得用 `/ru /rp` 存密码，或者改用「不管用户是否登录都运行」
- 建完必须 `/query /v` 回读「要运行的任务」，路径写错是这类任务最常见的静默失败

## 8. macOS / Linux 定时

`install-task.ps1` 只适用于 Windows。其它平台用 cron（注意 cron 的 PATH 很短，写 node 的绝对路径）：

```cron
# 每天 09:00
0 9 * * * /usr/local/bin/node "<skill>/scripts/sync.mjs" --config="<vault>/.yuque-sync/yuque-sync.config.json" >> "<vault>/.yuque-sync/sync.out.log" 2>&1
```

launchd 用 `StartCalendarInterval` 起同一条命令，plist 里同样写绝对路径。

## 9. 凭据暴露面

- yuque-dl 通过命令行参数 `-t/-p` 收凭据：同机其它账户在 `ps` / 任务管理器里能看到。共享机器上优先改用公开库，或同步后清 shell 历史。
- `sync.log` 只记知识库名和统计，不记 cookie。
- **`.gitignore` 作用域容易搞错**：技能自带的只保护技能目录；配置写在用户 vault 的 `.yuque-sync/` 里，那属于另一个 git 仓库（如果 vault 本身就是仓库）。必须让用户在 vault 自己的 `.gitignore` 里补一行 `.yuque-sync/`。

## 10. 公开但带密码的知识库

设了访问密码的公开库不用 cookie，用 yuque-dl 的 `-p/--password`。配置里写 `password` 字段即可，不要塞进 `session`。

**不给 cookie 的公开库有两个硬边界**：

- `--list-books` 用不了（该接口列的是「我的库」，没有登录态必然 401），只能让用户直接给知识库 URL 写进 `repos`
- 拿不到 `book_id`，而补图接口需要它 → `docImages` 返回空，补图数量为 0、失败数上涨。别承诺图片完整，让用户抽查

## 11. 性能量级

参考（百篇级、几十 MB 的库）：

- 首次全量下载：分钟级
- 增量（无变更）：几十秒
- 发布阶段：秒级（跳过了未变文件）

单个库超过几千篇时，建议 `incremental: true` 且不要频繁删 staging。
