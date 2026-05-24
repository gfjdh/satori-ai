/**
 * 诊断测试：搜索 "铃仙二号" 逐步追踪链路
 * 运行: npx tsx test/search-debug.ts
 */
import 'dotenv/config';

// ====== Step 1: 检查 getCurrentCharacterId 初始值 ======
console.log('\n====== STEP 1: 检查 getCurrentCharacterId 初始值 ======');
import { getCurrentCharacterId, setCurrentCharacterId, loadCharacterKnowledge, searchCharacterKnowledge } from '../src/character/knowledge.js';
console.log(`[STEP1] currentCharacterId = "${getCurrentCharacterId()}"`);

// ====== Step 2: 手动设置角色ID为 satori ======
console.log('\n====== STEP 2: 设置角色ID ======');
setCurrentCharacterId('satori');
console.log(`[STEP2] currentCharacterId = "${getCurrentCharacterId()}"`);

// ====== Step 3: 加载角色知识 ======
console.log('\n====== STEP 3: 加载角色知识 ======');
try {
  const knowledge = loadCharacterKnowledge('satori');
  console.log(`[STEP3] 加载了 ${knowledge.length} 条知识`);
  if (knowledge.length > 0) {
    console.log(`[STEP3] 第一条: id=${knowledge[0].id}, category=${knowledge[0].category}`);
    console.log(`[STEP3] 第一条 keywords: ${JSON.stringify(knowledge[0].keywords)}`);
    console.log(`[STEP3] 第一条 content前100字: ${knowledge[0].content.substring(0, 100)}`);

    // 找出包含"铃仙"的条目
    const reisenItems = knowledge.filter(k =>
      k.keywords.some(kw => kw.includes('铃仙')) ||
      k.content.includes('铃仙二号')
    );
    console.log(`[STEP3] 包含"铃仙"的条目数: ${reisenItems.length}`);
    if (reisenItems.length > 0) {
      console.log(`[STEP3] 第一个匹配条目: id=${reisenItems[0].id}, keywords=${JSON.stringify(reisenItems[0].keywords)}`);
    }
  }
} catch (error) {
  console.error(`[STEP3] 加载失败:`, error);
}

// ====== Step 4: 搜索角色知识 "铃仙二号" ======
console.log('\n====== STEP 4: 搜索 "铃仙二号" (仅角色知识) ======');
try {
  // 模拟 searchCharKnowledge 中的 effectiveTerms 逻辑
  const keywords: string[] = [];
  const query = '铃仙二号';
  const effectiveTerms = keywords.length > 0 ? keywords : (query.length >= 2 ? [query] : []);
  console.log(`[STEP4] effectiveTerms = ${JSON.stringify(effectiveTerms)}`);

  const raw = searchCharacterKnowledge('satori', effectiveTerms, 10);
  console.log(`[STEP4] searchCharacterKnowledge 返回 ${raw.length} 条结果`);
  if (raw.length > 0) {
    for (let i = 0; i < Math.min(3, raw.length); i++) {
      console.log(`[STEP4] 结果${i}: id=${raw[i].id}, category=${raw[i].category}, keywords=${JSON.stringify(raw[i].keywords)}`);
      console.log(`[STEP4] 结果${i} content前200字: ${raw[i].content.substring(0, 200)}`);
    }
  } else {
    console.log('[STEP4] ⚠️ 零结果！');
  }
} catch (error) {
  console.error(`[STEP4] 搜索失败:`, error);
}

// ====== Step 5: 完整模拟 searchCharKnowledge 函数 ======
console.log('\n====== STEP 5: 完整模拟 index.ts 中 searchCharKnowledge 的逻辑 ======');
import StringSimilarity from 'string-similarity';

function bm25Score(query: string, doc: string, keywords: string[]): number {
  const stringSim = StringSimilarity.compareTwoStrings(query.toLowerCase(), doc.toLowerCase());
  let totalTF = 0;
  const BM25_K1 = 1.6;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const docLower = doc.toLowerCase();
    let count = 0;
    let pos = 0;
    while ((pos = docLower.indexOf(kwLower, pos)) !== -1) {
      count++;
      pos += kwLower.length;
    }
    totalTF += count;
  }
  const bm25 = totalTF / (BM25_K1 + totalTF);
  const raw = stringSim + bm25 * 2;
  return Math.min(raw / 3, 1);
}

try {
  const query = '铃仙二号';
  const keywords: string[] = [];
  const topK = 5;

  const characterId = getCurrentCharacterId();
  console.log(`[STEP5] characterId = "${characterId}"`);

  const effectiveTerms = keywords.length > 0 ? keywords : (query.length >= 2 ? [query] : []);
  console.log(`[STEP5] effectiveTerms = ${JSON.stringify(effectiveTerms)}`);

  const raw = searchCharacterKnowledge(characterId, effectiveTerms, topK * 2); // topK*2 = 10
  console.log(`[STEP5] raw from searchCharacterKnowledge: ${raw.length} 条`);

  // 对每条raw结果计算 bm25Score
  const charResults = raw.map(r => ({
    id: r.id || crypto.randomUUID(),
    content: r.content,
    source: 'character_knowledge' as const,
    score: bm25Score(query, r.content, effectiveTerms),
    metadata: {}
  }));

  console.log(`[STEP5] 计算bm25Score后:`);
  for (let i = 0; i < Math.min(5, charResults.length); i++) {
    console.log(`  score=${charResults[i].score.toFixed(4)}, id=${charResults[i].id}`);
  }

  // filter score > 0
  const filtered = charResults.filter(r => r.score > 0);
  console.log(`[STEP5] filter(score>0) 后: ${filtered.length} 条`);

  const sorted = filtered.sort((a, b) => b.score - a.score);
  const final = sorted.slice(0, topK);
  console.log(`[STEP5] 最终结果: ${final.length} 条`);

  if (final.length === 0) {
    console.log('[STEP5] ⚠️ 最终结果为零！问题在 bm25Score 过滤或 searchCharacterKnowledge 返回空');
  }
} catch (error) {
  console.error(`[STEP5] 失败:`, error);
}

// ====== Step 6: 调用真实的 search() 入口（带详细内部日志） ======
async function step6() {
  console.log('\n====== STEP 6: 调用真实的 search() 入口 ======');

  // monkey-patch logDb.insert 来捕获所有内部日志
  const { logDb } = await import('../src/db/database.js');
  const originalInsert = logDb.insert.bind(logDb);
  logDb.insert = function(entry: any) {
    if (entry.category === 'retrieval' || entry.content?.includes('search') || entry.content?.includes('knowledge') || entry.content?.includes('Character')) {
      console.log(`  [LOG ${entry.level}] ${entry.content}`);
    }
    return originalInsert(entry);
  };

  console.log('[STEP6] 调用前 getCurrentCharacterId =', getCurrentCharacterId());

  const { search } = await import('../src/skills/search/index.js');
  const result = await search({ query: '铃仙二号', limit: 10 });
  console.log(`[STEP6] search() 结果:\n${result}`);

  // 检查结果中是否有角色知识
  if (result.includes('character_knowledge')) {
    console.log('[STEP6] ✅ 角色知识已出现在检索结果中');
  } else {
    console.log('[STEP6] ❌ 角色知识未出现在检索结果中');

    // 额外诊断：直接测试 loadCharacterKnowledge 的缓存状态
    console.log('[STEP6] 额外诊断:');
    const { loadCharacterKnowledge, searchCharacterKnowledge } = await import('../src/character/knowledge.js');
    const freshKnowledge = loadCharacterKnowledge('satori');
    console.log(`  loadCharacterKnowledge('satori') = ${freshKnowledge.length} 条`);
    const freshSearch = searchCharacterKnowledge('satori', ['铃仙二号'], 10);
    console.log(`  searchCharacterKnowledge('satori', ['铃仙二号'], 10) = ${freshSearch.length} 条`);
  }

  // 恢复原函数
  logDb.insert = originalInsert;
}

step6().then(() => {
  console.log('\n====== 诊断完成 ======');
});
