---
name: web-surfing
description: 网上冲浪 — 通过浏览器访问网页、阅读内容、与页面元素交互
triggerWords: [上网, 搜索, 浏览, 网页, 打开网站, 帮我查, 百度, google, 搜一下]
---

# 网上冲浪

通过真实浏览器环境访问网页，支持内容阅读和页面交互。

## 能力
- 导航到任意 URL
- 分页阅读网页内容（文本 + 可交互元素）
- 执行 JavaScript 操作页面元素
- 点击按钮/链接
- 在输入框中输入文本

## 限制
- 需要 browser 服务运行在端口 8743
- 页面内容按 1000 字符分页，按钮按 20 个分页

---

## web_navigate

**用途**：导航到指定 URL。

**参数**：
- `url`（必填）：要访问的网址

---

## web_observe

**用途**：阅读当前页面的内容。首次调用（page=0）会标记所有可交互元素并返回文本+按钮+输入框信息。可指定页码翻阅更多内容。

**参数**：
- `page`（可选）：页码，默认 0

---

## web_execute_js

**用途**：在当前页面执行 JavaScript。常用于点击元素（`document.querySelector('[data-alife-id="el-X"]').click()`）或在输入框填内容。

**参数**：
- `script`（必填）：要执行的 JavaScript 代码

**示例**：
```js
document.querySelector('[data-alife-id="el-0"]').click()
```

---

## web_click

**用途**：点击页面元素。selector 可以是 data-alife-id（如 `el-5`）或 CSS 选择器。

**参数**：
- `selector`（必填）：元素选择器

---

## web_type

**用途**：在输入框中输入文本。

**参数**：
- `selector`（必填）：输入框选择器
- `text`（必填）：要输入的文本
