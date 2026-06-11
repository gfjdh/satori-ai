"""
Embedding Service
使用 bert-base-chinese 模型提供文本向量化和检索API
"""

import os
import logging

# Suppress uvicorn access logs (health check polling noise)
logging.getLogger('uvicorn.access').setLevel(logging.WARNING)

# Use HF mirror for faster download in China (https://hf-mirror.com)
# User can override: set HF_ENDPOINT env var in .env or system environment
if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import torch
from transformers import BertModel, BertTokenizer
import numpy as np
from contextlib import asynccontextmanager

# 全局变量
tokenizer = None
model = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global tokenizer, model
    print("[Embedding Service] Loading bert-base-chinese model...")
    tokenizer = BertTokenizer.from_pretrained('bert-base-chinese')
    model = BertModel.from_pretrained('bert-base-chinese')
    model.eval()
    print("[Embedding Service] Model loaded successfully")
    yield
    print("[Embedding Service] Shutting down...")

app = FastAPI(title="Embedding Service", lifespan=lifespan)

class EncodeRequest(BaseModel):
    texts: List[str]

class EncodeResponse(BaseModel):
    embeddings: List[List[float]]
    model: str = "bert-base-chinese"

class SearchItem(BaseModel):
    id: str
    content: str

class SearchRequest(BaseModel):
    query: str
    items: List[SearchItem]
    top_k: int = 10

class SearchResult(BaseModel):
    id: str
    content: str
    score: float

class SearchResponse(BaseModel):
    results: List[SearchResult]
    query: str

def mean_pooling(model_output, attention_mask):
    """Mean Pooling - 取所有token输出向量的平均值"""
    token_embeddings = model_output.last_hidden_state
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)

def encode_texts(texts: List[str]) -> List[List[float]]:
    """将文本列表编码为向量列表"""
    with torch.no_grad():
        inputs = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors='pt')
        outputs = model(**inputs)
        embeddings = mean_pooling(outputs, inputs['attention_mask'])
        # L2 归一化
        embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
        return embeddings.numpy().tolist()

@app.get("/health")
async def health():
    return {"status": "ok", "model": "bert-base-chinese"}

@app.post("/encode", response_model=EncodeResponse)
async def encode(request: EncodeRequest):
    try:
        embeddings = encode_texts(request.texts)
        return EncodeResponse(embeddings=embeddings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    try:
        # 编码查询
        query_emb = encode_texts([request.query])[0]

        # 编码所有items
        item_texts = [item.content for item in request.items]
        item_embs = encode_texts(item_texts)

        # 计算余弦相似度
        results = []
        query_vec = np.array(query_emb)
        for i, item in enumerate(request.items):
            item_vec = np.array(item_embs[i])
            score = float(np.dot(query_vec, item_vec))
            results.append(SearchResult(
                id=item.id,
                content=item.content,
                score=score
            ))

        # 按相似度降序
        results.sort(key=lambda x: x.score, reverse=True)
        results = results[:request.top_k]

        return SearchResponse(results=results, query=request.query)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)