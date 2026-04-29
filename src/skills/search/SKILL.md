---
name: search
description: 搜索技能 - 在长期记忆和资料库中检索相关信息，支持分层召回策略
---

## 请求格式（Skill调用输入）

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
    "limit": 5
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 用户查询文本 |
| keywords.direct | string[] | 否 | 直接关键词 |
| timeRange | object | 否 | 时间范围筛选 |
| limit | number | 否 | 返回结果数量，默认5 |

## 使用要点

- 不要使用相似的关键词重复搜索，如果一次搜索结果不令人满意应当更换关键词或者结束搜索以节省资源和提高效率。