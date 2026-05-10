---
name: search
description: 搜索技能 - 在长期记忆、资料库和角色知识中检索信息
---

# 搜索技能

## 功能说明

在长期记忆、资料库和角色知识中检索与用户查询相关的信息。

## 通信格式

### 请求格式（Skill调用输入）

```json
{
  "action": "search",
  "params": {
    "query": "用户查询文本",
    "keywords": {
      "direct": ["关键词1", "关键词2"]
    },
    "timeRange": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    },
    "limit": 10
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 用户查询文本（用于字符串相似度计分） |
| keywords.direct | string[] | 否 | 直接关键词列表（用于 BM25 计分，权重为 query 的 2 倍） |
| timeRange | object | 否 | 时间范围筛选（仅对记忆生效） |
| limit | number | 否 | 返回结果总数，默认 10 |

### 响应格式

直接返回格式化字符串，格式为：
```
[检索结果] 查询: "xxx" | 找到: N 条 | 耗时: Xms

[memory topic 2024-01-01~2024-01-31] 内容摘要 (score: 0.xxx)
[knowledge 分类] 内容摘要 (score: 0.xxx)
[character_knowledge] {"id":"xxx",...} (score: 0.xxx)
```

## 检索策略

### 召回来源

| 来源 | 检索方式 | 说明 |
|------|----------|------|
| memories | 向量检索 + 关键词检索 | 各取 topK/2 后合并去重 |
| knowledge_base | 向量检索 + 关键词检索 | 各取 topK/2 后合并去重 |
| character_knowledge | 仅关键词检索 | 使用与 memoryDb.search 相同的 BM25 逻辑 |

### 计分规则

- **query**：使用 `string-similarity` 计算归一化得分（权重 1）
- **keywords**：使用 BM25 风格计分（关键词精确匹配加分），归一化得分（权重 2）
- **最终得分** = `stringSim_normalized + BM25_normalized * 2`

### 合并去重

三种来源的结果合并，按 score 排序取 top limit。

## 依赖库

- `string-similarity`：字符串相似度评分

## 错误处理

- 无结果：返回空数组格式
- 错误：返回 `[检索出错] {error message}`

## 使用示例

**场景1：基本检索**

```json
{
  "action": "search",
  "params": {
    "query": "游戏",
    "limit": 5
  }
}
```

**场景2：带关键词加权**

```json
{
  "action": "search",
  "params": {
    "query": "角色",
    "keywords": {
      "direct": ["东方Project", "铃仙"]
    },
    "limit": 5
  }
}
```

**场景3：时间范围筛选**

```json
{
  "action": "search",
  "params": {
    "query": "上次 聊",
    "timeRange": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    },
    "limit": 5
  }
}
```