/**
 * 跨模块实例验证测试：证明 source 和 dist 的 knowledge 模块共享 characterId
 *
 * 运行: npx tsx test/cross-module-test.ts
 */
import 'dotenv/config';
import path from 'path';

console.log('====== 跨模块实例验证 ======');
console.log(`process.env.CURRENT_CHARACTER_ID = "${process.env.CURRENT_CHARACTER_ID}"`);

// ====== 1. 加载 SOURCE 模块 (src) ======
console.log('\n--- 1. SOURCE 模块 ---');
import { getCurrentCharacterId as srcGetId, setCurrentCharacterId as srcSetId, loadCharacterKnowledge as srcLoad, searchCharacterKnowledge as srcSearch } from '../src/character/knowledge.js';

console.log(`src getCurrentCharacterId() = "${srcGetId()}"`);

// ====== 2. 加载 COMPILED 模块 (dist) ======
console.log('\n--- 2. COMPILED 模块 ---');
const distKnowledgePath = path.join(process.cwd(), 'dist', 'character', 'knowledge.js');
const distKnowledge = require(distKnowledgePath);

console.log(`dist getCurrentCharacterId() = "${distKnowledge.getCurrentCharacterId()}"`);

// ====== 3. 通过 SOURCE 模块设置 characterId ======
console.log('\n--- 3. 通过 SOURCE 设置 characterId ---');
srcSetId('satori');
console.log(`src getCurrentCharacterId() = "${srcGetId()}"`);
console.log(`dist getCurrentCharacterId() = "${distKnowledge.getCurrentCharacterId()}"`);

if (distKnowledge.getCurrentCharacterId() === 'satori') {
  console.log('✅ 跨模块状态同步成功！');
} else {
  console.log('❌ 跨模块状态未同步 - dist 模块仍为空');
}

// ====== 4. 通过 COMPILED 模块加载和搜索角色知识 ======
console.log('\n--- 4. COMPILED 模块搜索 "铃仙二号" ---');
const distKnowledge2 = distKnowledge.loadCharacterKnowledge('satori');
console.log(`dist loadCharacterKnowledge('satori') = ${distKnowledge2.length} 条`);
const distResults = distKnowledge.searchCharacterKnowledge('satori', ['铃仙二号'], 10);
console.log(`dist searchCharacterKnowledge('satori', ['铃仙二号'], 10) = ${distResults.length} 条`);
if (distResults.length > 0) {
  console.log(`  结果: id=${distResults[0].id}, name=${(distResults[0].rawData as any)?.name}`);
}

// ====== 5. 模拟 searchSkill 完整调用链 ======
console.log('\n--- 5. 完整 search skill 调用链 ---');
const { search } = require(path.join(process.cwd(), 'dist', 'skills', 'search', 'index.js'));
(async () => {
  const result = await search({ query: '铃仙二号', limit: 10 });
  console.log(result);

  if (result.includes('character_knowledge')) {
    console.log('\n✅✅✅ 修复成功：角色知识出现在检索结果中');
  } else {
    console.log('\n❌❌❌ 修复失败：角色知识仍缺失');
  }
})();
