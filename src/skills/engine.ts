import fs from 'fs';
import path from 'path';
import { Skill, SkillMeta } from '../types/index.js';
import { logDb, now } from '../db/database.js';

const SKILLS_ROOT = path.join(process.cwd(), 'src', 'skills');

// Skill配置接口
export interface SkillConfig {
  [key: string]: string;
}

// 获取Skill的配置（从环境变量读取，格式：SKILL_<NAME>_<KEY>）
export function getSkillConfig(skillName: string): SkillConfig {
  const config: SkillConfig = {};
  const prefix = `SKILL_${skillName.toUpperCase()}_`;

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix)) {
      const configKey = key.substring(prefix.length);
      config[configKey] = value || '';
    }
  }

  return config;
}

interface ParsedSkillMeta {
  name: string;
  description: string;
  version?: string;
  author?: string;
  triggerWords?: string[];
}

// ========== Skill引擎 ==========
class SkillEngine {
  private skills: Map<string, SkillMeta> = new Map(); // name -> meta
  private loadedSkills: Map<string, Skill> = new Map(); // name -> full skill
  private recentSkills: string[] = []; // 最近调用的skill列表（最多3个）
  private skillCache: Map<string, string> = new Map(); // skill name -> SKILL.md content

  private readonly MAX_CACHED_SKILLS = 3;

  constructor() {
    this.scanAndLoad();
  }

  // 扫描skills目录，加载元信息
  private scanAndLoad(): void {
    if (!fs.existsSync(SKILLS_ROOT)) {
      fs.mkdirSync(SKILLS_ROOT, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(SKILLS_ROOT, entry.name);
        const skillFile = path.join(skillPath, 'SKILL.md');

        if (fs.existsSync(skillFile)) {
          try {
            const meta = this.parseSkillMeta(skillFile);
            if (meta) {
              this.skills.set(meta.name, meta);
              logDb.insert({ id: crypto.randomUUID(), level: 'info', category: 'agent', content: `Loaded skill: ${meta.name}`, createdAt: now() });
            }
          } catch (err) {
            logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Failed to load skill ${entry.name}: ${err}`, createdAt: now() });
          }
        }
      }
    }
  }

  // 解析SKILL.md的YAML frontmatter
  private parseSkillMeta(skillFile: string): ParsedSkillMeta | null {
    const content = fs.readFileSync(skillFile, 'utf-8');
    const lines = content.split('\n');

    let name = '';
    let description = '';
    let version: string | undefined;
    let author: string | undefined;
    let triggerWords: string[] | undefined;

    let inFrontmatter = false;

    for (const line of lines) {
      if (line.trim() === '---') {
        if (inFrontmatter) break; // frontmatter结束
        inFrontmatter = true;
        continue;
      }

      if (inFrontmatter) {
        if (line.startsWith('name:')) {
          name = line.substring(5).trim();
        } else if (line.startsWith('description:')) {
          description = line.substring(12).trim();
        } else if (line.startsWith('version:')) {
          version = line.substring(8).trim();
        } else if (line.startsWith('author:')) {
          author = line.substring(7).trim();
        } else if (line.startsWith('triggerWords:')) {
          const raw = line.substring(13).trim();
          const match = raw.match(/\[([^\]]*)\]/);
          if (match) {
            triggerWords = match[1].split(',').map(w => w.trim()).filter(w => w.length > 0);
          }
        }
      }
    }

    // 从目录名获取name（如果frontmatter没有）
    if (!name) {
      name = path.basename(path.dirname(skillFile));
    }

    if (!name) return null;

    return { name, description, version, author, triggerWords };
  }

  // 获取所有skill的元信息（启动时使用）
  getAllSkillMetas(): SkillMeta[] {
    return Array.from(this.skills.values());
  }

  // 根据用户输入匹配触发词，返回命中的SkillMeta列表
  matchTriggerSkills(userInput: string): SkillMeta[] {
    const matched: SkillMeta[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggerWords && skill.triggerWords.length > 0) {
        if (skill.triggerWords.some(w => userInput.includes(w))) {
          matched.push(skill);
        }
      }
    }
    return matched;
  }

  // 根据名称获取skill元信息
  getSkillMeta(name: string): SkillMeta | undefined {
    return this.skills.get(name);
  }

  // 加载完整的skill（按需）
  async loadSkill(name: string): Promise<Skill | null> {
    // 如果已加载，直接返回
    if (this.loadedSkills.has(name)) {
      return this.loadedSkills.get(name)!;
    }

    const meta = this.skills.get(name);
    if (!meta) return null;

    const skillPath = path.join(SKILLS_ROOT, name);
    const skillFile = path.join(skillPath, 'SKILL.md');

    if (!fs.existsSync(skillFile)) {
      return null;
    }

    const content = fs.readFileSync(skillFile, 'utf-8');

    const skill: Skill = {
      ...meta,
      rootPath: skillPath,
      content: content,
      scriptsPath: path.join(skillPath, 'scripts'),
      referencesPath: path.join(skillPath, 'references'),
      assetsPath: path.join(skillPath, 'assets')
    };

    this.loadedSkills.set(name, skill);
    return skill;
  }

  // 执行skill的脚本
  // 返回值规范：必须返回字符串，所有状态信息（成功/失败）都嵌入字符串content中
  async executeSkill(skillName: string, params: Record<string, unknown>): Promise<string> {
    const skill = await this.loadSkill(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);

    // 优先使用编译后的脚本（位于 dist/skills/<skillName>/index.js）
    const compiledScriptPath = path.join(process.cwd(), 'dist', 'skills', skillName, 'index.js');

    let scriptPath: string;
    let useCompiled = false;

    if (fs.existsSync(compiledScriptPath)) {
      scriptPath = compiledScriptPath;
      useCompiled = true;
    } else {
      // 回退到 scripts 目录
      if (!fs.existsSync(skill.scriptsPath)) {
        throw new Error(`Scripts directory not found for skill: ${skillName}`);
      }

      const scriptFiles = fs.readdirSync(skill.scriptsPath)
        .filter(f => f.endsWith('.js') || f.endsWith('.ts'));

      if (scriptFiles.length === 0) {
        throw new Error(`No script found for skill: ${skillName}`);
      }

      // 使用主脚本（通常是 index.js 或第一个 .js 文件）
      const mainScript = scriptFiles.find(f => f === 'index.js') || scriptFiles[0];
      scriptPath = path.join(skill.scriptsPath, mainScript);
    }

    // 动态导入脚本
    try {
      const module = await import(`file://${scriptPath}`);

      // 查找导出函数（通常以skillName命名或使用默认导出）
      const handler = module[skillName] || module.default;

      if (typeof handler === 'function') {
        return await handler(params);
      } else {
        throw new Error(`No handler function found in script: ${path.basename(scriptPath)}`);
      }
    } catch (error) {
      logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Failed to execute skill ${skillName}: ${error}`, createdAt: now() });
      throw error;
    } finally {
      // 更新skill缓存：将该skill移到recentSkills末尾（最新）
      this.updateSkillCache(skillName, skill.content);
    }
  }

  // 更新skill缓存
  private updateSkillCache(skillName: string, content: string): void {
    // 从数组中移除（如果已存在）
    const index = this.recentSkills.indexOf(skillName);
    if (index !== -1) {
      this.recentSkills.splice(index, 1);
    }

    // 添加到末尾
    this.recentSkills.push(skillName);
    this.skillCache.set(skillName, content);

    // 保持最多MAX_CACHED_SKILLS个
    while (this.recentSkills.length > this.MAX_CACHED_SKILLS) {
      const oldest = this.recentSkills.shift();
      if (oldest) {
        this.skillCache.delete(oldest);
      }
    }
  }

  // 获取缓存中已加载的 skill 名称列表
  getCachedSkillNames(): string[] {
    return [...this.recentSkills];
  }

  // 获取最近使用的skill的SKILL.md内容（用于上下文注入）
  // 缓存为空时预加载 search 和 image-analysis 两个内置 skill
  async getRecentSkillsContext(): Promise<string> {
    // if (this.recentSkills.length === 0) {
    //   const defaults = ['search', 'image-analysis'];
    //   for (const name of defaults) {
    //     if (!this.skills.has(name)) continue;
    //     const skill = await this.loadSkill(name);
    //     if (skill) {
    //       this.recentSkills.push(name);
    //       this.skillCache.set(name, skill.content);
    //     }
    //   }
    //   if (this.recentSkills.length === 0) return '';
    // }

    const parts: string[] = ['[最近使用的Skill参考]'];
    for (const name of this.recentSkills) {
      const content = this.skillCache.get(name);
      if (content) {
        parts.push(`\n--- ${name} ---\n${content}\n`);
      }
    }

    return parts.join('');
  }

  // 安装skill（从本地文件夹）
  installSkill(sourcePath: string): SkillMeta | null {
    const name = path.basename(sourcePath);
    const destPath = path.join(SKILLS_ROOT, name);
    const skillFile = path.join(destPath, 'SKILL.md');

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    if (!fs.existsSync(skillFile)) {
      throw new Error(`SKILL.md not found in: ${sourcePath}`);
    }

    // 复制到skills目录
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    fs.cpSync(sourcePath, destPath, { recursive: true });

    // 重新加载
    const meta = this.parseSkillMeta(skillFile);
    if (meta) {
      this.skills.set(meta.name, meta);
    }

    return meta || null;
  }

  // 卸载skill
  uninstallSkill(name: string): boolean {
    const skillPath = path.join(SKILLS_ROOT, name);

    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { recursive: true });
      this.skills.delete(name);
      this.loadedSkills.delete(name);
      return true;
    }

    return false;
  }
}

// 导出单例
export const skillEngine = new SkillEngine();
export default SkillEngine;
