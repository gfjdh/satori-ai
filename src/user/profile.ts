import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logDb } from '../db/database.js';

// 用户画像条目
export interface UserProfileEntry {
  id: string;
  content: string;
  importance: number; // 1-5，越高越重要
  category: string; // 'personality' | 'habit' | 'preference' | 'other'
  createdAt: string;
  updatedAt: string;
}

// 用户画像
export interface UserProfile {
  entries: UserProfileEntry[];
  lastSummary: string; // 上次总结时间
}

const DATA_DIR = path.join(process.cwd(), 'data');
const PROFILE_PATH = path.join(DATA_DIR, 'user_profile.json');

// 确保data目录存在
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 加载用户画像
export function loadUserProfile(): UserProfile {
  ensureDataDir();

  if (!fs.existsSync(PROFILE_PATH)) {
    const defaultProfile: UserProfile = {
      entries: [],
      lastSummary: new Date().toISOString()
    };
    saveUserProfile(defaultProfile);
    return defaultProfile;
  }

  try {
    const content = fs.readFileSync(PROFILE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logDb.insert({ id: crypto.randomUUID(), level: 'error', category: 'agent', content: `Failed to load profile: ${error}`, createdAt: new Date() });
    return { entries: [], lastSummary: new Date().toISOString() };
  }
}

// 保存用户画像
export function saveUserProfile(profile: UserProfile): void {
  ensureDataDir();
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
}

// 添加画像条目
export function addProfileEntry(
  content: string,
  category: UserProfileEntry['category'],
  importance: number = 3
): UserProfileEntry {
  const profile = loadUserProfile();

  const entry: UserProfileEntry = {
    id: uuidv4(),
    content,
    importance: Math.max(1, Math.min(5, importance)),
    category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  profile.entries.push(entry);

  // 限制最大条目数（100条），删除重要性最低的
  if (profile.entries.length > 100) {
    profile.entries.sort((a, b) => a.importance - b.importance);
    profile.entries = profile.entries.slice(0, 100);
  }

  saveUserProfile(profile);
  return entry;
}

// 更新画像条目
export function updateProfileEntry(
  id: string,
  updates: Partial<Pick<UserProfileEntry, 'content' | 'importance' | 'category'>>
): boolean {
  const profile = loadUserProfile();
  const entry = profile.entries.find(e => e.id === id);

  if (!entry) {
    return false;
  }

  if (updates.content !== undefined) {
    entry.content = updates.content;
  }
  if (updates.importance !== undefined) {
    entry.importance = Math.max(1, Math.min(5, updates.importance));
  }
  if (updates.category !== undefined) {
    entry.category = updates.category;
  }
  entry.updatedAt = new Date().toISOString();

  saveUserProfile(profile);
  return true;
}

// 删除画像条目
export function deleteProfileEntry(id: string): boolean {
  const profile = loadUserProfile();
  const index = profile.entries.findIndex(e => e.id === id);

  if (index === -1) {
    return false;
  }

  profile.entries.splice(index, 1);
  saveUserProfile(profile);
  return true;
}

// 获取画像条目（按分类筛选）
export function getProfileEntries(category?: UserProfileEntry['category']): UserProfileEntry[] {
  const profile = loadUserProfile();

  if (category) {
    return profile.entries.filter(e => e.category === category);
  }

  return profile.entries.sort((a, b) => b.importance - a.importance);
}

// 更新总结时间
export function updateLastSummary(): void {
  const profile = loadUserProfile();
  profile.lastSummary = new Date().toISOString();
  saveUserProfile(profile);
}

// 获取用户画像描述（用于插入prompt）
export function getUserProfileDescription(): string {
  const entries = getProfileEntries();

  if (entries.length === 0) {
    return '用户画像：暂无信息';
  }

  const parts: string[] = ['用户画像：'];

  // 按分类分组
  const byCategory: Record<string, UserProfileEntry[]> = {};
  for (const entry of entries) {
    if (!byCategory[entry.category]) {
      byCategory[entry.category] = [];
    }
    byCategory[entry.category].push(entry);
  }

  for (const [cat, catEntries] of Object.entries(byCategory)) {
    const items = catEntries.map(e => e.content).join('、');
    parts.push(`${cat}：${items}`);
  }

  return parts.join('\n');
}
