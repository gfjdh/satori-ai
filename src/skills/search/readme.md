---
name: search
description: 搜索技能 - 在长期记忆和资料库中检索相关信息，支持分层召回策略
---

# 搜索技能

## 功能说明

在长期记忆和资料库中检索与用户查询相关的信息。实现**分层召回策略**：先召回最粗粒度记忆，如果需要再细化到更细粒度。

## 通信格式

### 请求格式（Skill调用输入）

```json
{
  "action": "search",
  "params": {
    "query": "用户查询文本",
    "keywords": {
      "direct": ["关键词1"]
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
| query | string | 是 | 用户查询文本 |
| keywords.direct | string[] | 否 | 直接关键词 |
| timeRange | object | 否 | 时间范围筛选 |
| limit | number | 否 | 返回结果数量，默认10 |

### 响应格式（Skill返回结果）

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "source": "memory",
        "granularity": "month",
        "content": "用户上个月对游戏比较感兴趣...",
        "relevance": 0.85,
        "keywords_matched": {
          "direct": ["游戏"]
        },
        "period": {
          "start": "2024-03-01",
          "end": "2024-03-31"
        },
        "shouldRefine": false,
        "refineKeywords": null
      }
    ],
    "total": 1,
    "query": "游戏",
    "search_time_ms": 45
  },
  "error": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 是否成功 |
| data.results | array | 检索结果列表 |
| data.total | number | 总结果数 |
| data.query | string | 实际使用的查询 |
| data.search_time_ms | number | 搜索耗时（毫秒） |
| error | string | 错误信息，成功时为null |

## 分层召回策略

### 粒度层级（从粗到细）

```
year → season → month → week → day → topic
```

### 检索流程

1. **分层检索模式**（默认）
   - 使用 `memoryDb.search` 根据关键词和时间范围召回记忆（已在数据库层计算相关性）
   - 如果粗粒度记忆仅一条，自动触发细化召回下一粒度
   - 如果粗粒度记忆内容提到新关键词但无具体细节，触发细化

### 关键词权重

| 类型 | 权重 | 说明 |
|------|------|------|
| 直接关键词 | 1.0 | 精确匹配 |

### 相关性计算

- **记忆**：关键词覆盖度
- **资料库**：`knowledgeDb.search` 内部计算
- **角色卡资料**：`searchCharacterKnowledge` 内部计算，额外乘以1.2

## 检索范围

| 来源 | 粒度 | 说明 |
|------|------|------|
| memories表 | year/season/month/week/day/topic | 长期记忆，按时间分层 |
| knowledge_base表 | - | 资料库，无时间粒度 |
| character-cards/<id>/knowledge | - | 角色卡附带资料 |

## 依赖库

- `string-similarity`：字符串相似度评分

## 错误处理

- 数据库连接失败：返回 `success: false`，error说明具体原因
- 无结果：返回空数组，success仍为true

## 使用示例

**场景1：用户问"你还记得我们上次聊的游戏吗？"**

```json
{
  "action": "search",
  "params": {
    "query": "游戏 上次 聊",
    "limit": 5
  }
}
```

**场景2：带关键词权重的检索**

```json
{
  "action": "search",
  "params": {
    "query": "工作",
    "keywords": {
      "direct": ["工作"],
      "associative": ["职业", "上班"]
    },
    "limit": 5
  }
}
```
