---
name: web-surfing
description: 网上冲浪 — 通过浏览器访问网页、阅读内容、与页面元素交互
triggerWords: [上网, 搜索, 浏览, 网页, 打开网站, 帮我查, 百度, google, 搜一下, 联网]
---

# 网上冲浪

通过真实浏览器环境访问网页，支持内容阅读和页面交互。**这是唯一能联网获取实时信息的工具。当用户要求搜索、查询互联网上的信息时，使用此 skill。**

## 标准工作流

```
navigate(url) → observe(page=0) → [click/type] → observe(page=0) → ...
```

**核心原则**：
- 每次 click/type 之后，**必须用 observe 查看结果**。click/type 只返回操作是否成功和当前 URL，不返回页面内容
- 如果 click 后返回的 URL 没变，说明页面是 JS 驱动的，改用 `web_execute_js` 操作
- 搜索框输入流程：`web_type(搜索框id, 关键词)` → `web_click(搜索按钮id)` → `web_observe()`

## 能力
- 导航到任意 URL
- 分页阅读网页内容（文本 + 可交互元素）
- 执行 JavaScript 操作页面元素
- 点击按钮/链接
- 在输入框中输入文本

## 限制
- 一般情况下搜索时使用中文关键词，除非用户明确要求使用其他语言
- 页面内容按 1000 字符分页，按钮按 20 个分页
- 部分网站的链接使用 JS 跳转，click 可能不会触发完整页面导航。此时用 web_execute_js 直接操作 DOM

## 常用url
- 必应搜索：https://www.bing.com/search?q=关键词

---

## web_navigate

**用途**：导航到指定 URL。返回页面标题和 URL。

**参数**：
- `url`（必填）：要访问的网址

---

## web_observe

**用途**：阅读当前页面的内容。首次调用（page=0）会标记所有可交互元素并返回文本+按钮+输入框信息。可指定页码翻阅更多内容。

**重要**：每次 click 或 type 操作后，必须调用 observe 来查看页面变化。

**参数**：
- `page`（可选）：页码，默认 0

---

## web_execute_js

**用途**：在当前页面执行 JavaScript。当 web_click 无法触发 JS 驱动的导航时使用此工具直接操作 DOM。也可用于读取页面特定元素的内容。

**参数**：
- `script`（必填）：要执行的 JavaScript 代码

**示例**：
```js
document.querySelector('[data-alife-id="el-0"]').click()
```

---

## web_click

**用途**：点击页面元素。返回操作状态、当前 URL 和页面标题。**点击后必须 observe 查看结果。**

selector 可以是 data-alife-id（如 `el-5`）或 CSS 选择器。

**参数**：
- `selector`（必填）：元素选择器

---

## web_type

**用途**：在输入框中输入文本（会先清空原有内容）。返回操作状态和当前 URL。

**参数**：
- `selector`（必填）：输入框选择器
- `text`（必填）：要输入的文本
