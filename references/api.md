# 用到的语雀内部接口

都是网页端自用的接口，靠 `_yuque_session` cookie 授权。官方 v2 API 需要个人令牌（免费账号没有），所以走这些。

所有请求都带：

```
cookie: _yuque_session=<...>
user-agent: Mozilla/5.0 ... Chrome/...
```

## 1. 列出账号下的知识库

```
GET https://www.yuque.com/api/mine/book_stacks
```

返回 `data[].books[]`，每个 book 含 `id`、`name`、`slug`、`items_count`、`public`。

脚本用途：`--list-books` 给用户挑库；同步时按 slug 反查 `book_id`（补图接口需要）。

## 2. 取单篇文档正文（Markdown）

```
GET https://www.yuque.com/api/docs/<slug>?book_id=<id>&merge_dynamic_data=false&mode=markdown
```

- `slug` 是文档 URL 的最后一段，不是 doc_id
- 带 `mode=markdown` 时，正文在 `data.sourcecode`，是标准 Markdown，图片给的是 `https://cdn.nlark.com/...` 原始地址
- 不带 `mode=markdown` 时返回 Lake JSON（`data.content`），没有 `data.body` 字段
- 缺 `book_id` 会 404

脚本用途：补图时拿原图地址。**一篇文章只请求一次**，不要按图片逐个请求。

## 3. 图片下载

直接 GET `https://cdn.nlark.com/yuque/...`。实测不带 referer 也能 200，带上 `referer: https://www.yuque.com/` 更稳。

外链图（CSDN 等）按域名决定要不要 referer，见 `gotchas.md`。

## 常见状态码

| 状态 | 含义 |
|---|---|
| 200 | 正常 |
| 401 | cookie 过期或没有权限，让用户重取 |
| 404 | 文档 slug 不存在 / 缺 book_id / 文档已删 |

## 调试

不写代码也能验：

```bash
curl -s -H "cookie: _yuque_session=<值>" "https://www.yuque.com/api/mine/book_stacks" | head -c 300
```

返回 `{"status":401}` 就是 cookie 问题；返回 book 列表说明接口没变。

如果语雀改版导致 `/api/mine/book_stacks` 或 `/api/docs` 路径变化，先更新这里，再改 `scripts/sync.mjs` 里对应的两个函数（`books()` 和 `docImages()`），其余逻辑不受影响。
