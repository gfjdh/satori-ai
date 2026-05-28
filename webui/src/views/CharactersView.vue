<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElDialog, ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheck, CircleCheckFilled } from '@element-plus/icons-vue'
import {
  characterApi,
  type CharacterConfig,
  type CharacterSummary
} from '@/api'

const characters = ref<CharacterSummary[]>([])
const selectedId = ref('')
const selectedCharacter = ref<CharacterConfig | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const isCreating = ref(false)
const advancedJson = ref('{}')
const importOverwrite = ref(false)
const importInput = ref<HTMLInputElement>()
const live2dInput = ref<HTMLInputElement>()
const ttsInput = ref<HTMLInputElement>()

const basicForm = ref({
  id: '',
  name: '',
  personality: '',
  speechLanguage: '',
  subtitleLanguage: '',
  emotionRegressionRate: 0.01,
  characterInfo: '',
  dialogueRequirements: ''
})

const selectedSummary = computed(() => {
  return characters.value.find(item => item.id === selectedId.value) || null
})

const currentId = computed(() => {
  return characters.value.find(item => item.isCurrent)?.id || ''
})

function getErrorMessage(error: unknown): string {
  const maybe = error as { response?: { data?: { error?: string } }; message?: string }
  return maybe.response?.data?.error || maybe.message || String(error)
}

function pickAdvancedFields(character: CharacterConfig) {
  const {
    id,
    name,
    personality,
    speechLanguage,
    subtitleLanguage,
    emotionRegressionRate,
    characterInfo,
    dialogueRequirements,
    ...rest
  } = character
  return rest
}

function fillForm(character: CharacterConfig) {
  selectedCharacter.value = character
  basicForm.value = {
    id: character.id,
    name: character.name,
    personality: character.personality,
    speechLanguage: character.speechLanguage || '',
    subtitleLanguage: character.subtitleLanguage || '',
    emotionRegressionRate: character.emotionRegressionRate ?? 0.01,
    characterInfo: character.characterInfo || '',
    dialogueRequirements: character.dialogueRequirements || ''
  }
  advancedJson.value = JSON.stringify(pickAdvancedFields(character), null, 2)
}

function buildConfig(): CharacterConfig {
  let advanced: Record<string, unknown> = {}
  try {
    advanced = advancedJson.value.trim() ? JSON.parse(advancedJson.value) : {}
  } catch {
    throw new Error('高级配置不是有效 JSON')
  }

  return {
    ...advanced,
    id: basicForm.value.id.trim(),
    name: basicForm.value.name.trim(),
    personality: basicForm.value.personality.trim(),
    speechLanguage: basicForm.value.speechLanguage.trim() || undefined,
    subtitleLanguage: basicForm.value.subtitleLanguage.trim() || undefined,
    emotionRegressionRate: Number(basicForm.value.emotionRegressionRate),
    characterInfo: basicForm.value.characterInfo,
    dialogueRequirements: basicForm.value.dialogueRequirements
  } as CharacterConfig
}

async function loadCharacters() {
  isLoading.value = true
  try {
    const res = await characterApi.list()
    characters.value = res.data || []
    if (selectedId.value && !characters.value.some(character => character.id === selectedId.value)) {
      selectedId.value = ''
      selectedCharacter.value = null
    }
    if (!selectedId.value && characters.value.length > 0) {
      await selectCharacter(characters.value[0].id)
    } else if (selectedId.value) {
      await selectCharacter(selectedId.value)
    }
  } catch (error) {
    ElMessage.error(`角色列表加载失败：${getErrorMessage(error)}`)
  } finally {
    isLoading.value = false
  }
}

async function selectCharacter(id: string) {
  if (isCreating.value) {
    if (id === selectedId.value) return
    const confirm = await ElMessageBox.confirm(
      '当前正在创建角色，切换角色会丢失未保存的更改。确定要切换吗？',
      '确认切换',
      {
        confirmButtonText: '切换',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).catch(() => false)
    if (!confirm) return
    isCreating.value = false
  }
  selectedId.value = id
  try {
    const res = await characterApi.get(id)
    fillForm(res.data)
  } catch (error) {
    ElMessage.error(`角色详情加载失败：${getErrorMessage(error)}`)
  }
}

function startCreate() {
  isCreating.value = true
  selectedId.value = ''
  selectedCharacter.value = null
  basicForm.value = {
    id: '',
    name: '',
    personality: '',
    speechLanguage: 'ja-JP',
    subtitleLanguage: 'zh-CN',
    emotionRegressionRate: 0.01,
    characterInfo: '',
    dialogueRequirements: ''
  }
  advancedJson.value = JSON.stringify({ live2d: { modelOffsetX: 0, modelOffsetY: 0 } }, null, 2)
}

async function saveCharacter() {
  isSaving.value = true
  try {
    const config = buildConfig()
    if (isCreating.value) {
      await characterApi.create(config)
      ElMessage.success('角色已创建')
      isCreating.value = false
      selectedId.value = config.id
    } else {
      await characterApi.update(config.id, config)
      ElMessage.success('角色已保存')
    }
    await loadCharacters()
  } catch (error) {
    ElMessage.error(getErrorMessage(error))
  } finally {
    isSaving.value = false
  }
}

async function activateCharacter(id: string) {
  if (!id) return
  try {
    await characterApi.activate(id)
    await loadCharacters()
    ElMessage.success('角色已设为当前运行角色')
  } catch (error) {
    ElMessage.error(`启用失败：${getErrorMessage(error)}`)
  }
}

async function deleteSelectedCharacter() {
  if (!selectedId.value || !selectedSummary.value) return

  if (selectedSummary.value.isCurrent) {
    ElMessage.warning('不能删除当前正在使用的角色，请先切换到其他角色')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定删除角色 ${selectedSummary.value.name} 吗？该操作会删除整个角色卡目录。`,
      '删除角色',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )

    await characterApi.delete(selectedId.value)
    ElMessage.success('角色已删除')
    selectedId.value = ''
    selectedCharacter.value = null
    await loadCharacters()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(`删除失败：${getErrorMessage(error)}`)
  }
}

async function uploadLive2D(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !selectedId.value) return

  try {
    await ElMessageBox.confirm('上传后会替换该角色现有 live2d 文件夹。', '替换 Live2D 模型', {
      confirmButtonText: '替换',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await characterApi.uploadLive2D(selectedId.value, file)
    ElMessage.success('Live2D 模型已替换')
    await loadCharacters()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(`上传失败：${getErrorMessage(error)}`)
  }
}

async function uploadTTS(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !selectedId.value) return

  try {
    await ElMessageBox.confirm('上传后会替换该角色现有 TTS 文件夹（包括 GPT-SoVITS 对应的配置和权重、参考音频等）。', '替换 TTS 模型', {
      confirmButtonText: '替换',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await characterApi.uploadTTS(selectedId.value, file)
    ElMessage.success('TTS 模型已替换')
    await loadCharacters()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(`上传失败：${getErrorMessage(error)}`)
  }
}

async function importArchive(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    const res = await characterApi.importArchive(file, importOverwrite.value)
    ElMessage.success('角色已导入')
    selectedId.value = res.data.id
    await loadCharacters()
  } catch (error) {
    ElMessage.error(`导入失败：${getErrorMessage(error)}`)
  }
}

function exportArchive() {
  if (!selectedId.value) return
  window.open(characterApi.exportArchiveUrl(selectedId.value), '_blank')
}

function openImportPicker() {
  importInput.value?.click()
}

function openLive2DPicker() {
  live2dInput.value?.click()
}

function openTTSPicker() {
  ttsInput.value?.click()
}

onMounted(loadCharacters)
</script>

<template>
  <div class="characters-view">
    <div class="page-header">
      <div>
        <h2>角色管理</h2>
      </div>
      <div class="header-actions">
        <el-checkbox v-model="importOverwrite">导入时覆盖同名角色</el-checkbox>
        <el-button @click="openImportPicker">导入角色 ZIP</el-button>
        <input ref="importInput" class="hidden-input" type="file" accept=".zip,application/zip"
          @change="importArchive" />
        <el-button type="primary" @click="startCreate">新建角色</el-button>
      </div>
    </div>

    <div class="layout">
      <aside class="character-list">
        <div class="list-title">可用角色</div>
        <el-empty v-if="!isLoading && characters.length === 0" description="暂无角色" />
        <div v-for="character in characters" :key="character.id" class="character-item"
          :class="{ active: character.id === selectedId, current: character.isCurrent }"
          @click="selectCharacter(character.id)">
          <div class="item-status-icon" @click.stop="activateCharacter(character.id)"
            :title="character.isCurrent ? '当前角色' : '设为当前'">
            <el-icon :size="20" :color="character.isCurrent ? '#f56c6c' : '#dcdfe6'" class="status-icon"
              :class="{ 'is-inactive': !character.isCurrent }">
              <CircleCheckFilled v-if="character.isCurrent" />
              <CircleCheck v-else />
            </el-icon>
          </div>
          <span class="item-name">{{ character.name }}</span>
          <span class="item-tag-live2d">
            <el-tag size="small" :type="character.hasLive2D ? 'success' : 'info'" effect="plain">
              {{ character.hasLive2D ? 'Live2D' : '无Live2D' }}
            </el-tag>
          </span>
          <span class="item-tag-tts">
            <el-tag size="small" :type="character.hasTTS ? 'success' : 'info'" effect="plain">
              {{ character.hasTTS ? 'TTS' : '无TTS' }}
            </el-tag>
          </span>
          <span class="item-meta">{{ character.id }}</span>
        </div>
      </aside>

      <section class="editor">
        <el-empty v-if="!selectedCharacter && !isCreating" description="选择或新建一个角色" />

        <template v-else>
          <div class="editor-toolbar">
            <div>
              <h3>{{ isCreating ? '新建角色' : selectedSummary?.name || basicForm.name }}</h3>
              <p v-if="selectedSummary?.modelFile">Live2D：{{ selectedSummary.modelFile }}</p>
              <p v-if="selectedSummary?.ttsConfigFile">TTS：{{ selectedSummary.ttsConfigFile }}</p>
            </div>
            <div class="toolbar-actions">
              <el-button :disabled="isCreating" @click="exportArchive">导出 ZIP</el-button>
              <el-button :disabled="isCreating" @click="openLive2DPicker">载入 Live2D</el-button>
              <el-button :disabled="isCreating" @click="openTTSPicker">载入 TTS</el-button>
              <el-button type="danger" plain :disabled="isCreating || selectedSummary?.isCurrent"
                @click="deleteSelectedCharacter">
                删除角色
              </el-button>
              <input ref="live2dInput" class="hidden-input" type="file" accept=".zip,application/zip"
                @change="uploadLive2D" />
              <input ref="ttsInput" class="hidden-input" type="file" accept=".zip,application/zip"
                @change="uploadTTS" />
              <el-button type="primary" :loading="isSaving" @click="saveCharacter">保存</el-button>
            </div>
          </div>

          <el-form label-position="top" class="character-form">
            <div class="form-grid">
              <el-form-item label="角色 ID">
                <el-input v-model="basicForm.id" :disabled="!isCreating" placeholder="satori" />
              </el-form-item>
              <el-form-item label="名称">
                <el-input v-model="basicForm.name" />
              </el-form-item>
              <el-form-item label="语音语言">
                <el-input v-model="basicForm.speechLanguage" placeholder="ja-JP" />
              </el-form-item>
              <el-form-item label="字幕语言">
                <el-input v-model="basicForm.subtitleLanguage" placeholder="zh-CN" />
              </el-form-item>
              <el-form-item label="情绪回归率">
                <el-input-number v-model="basicForm.emotionRegressionRate" :step="0.01" :min="0" :max="1" />
              </el-form-item>
            </div>

            <el-form-item label="性格">
              <el-input v-model="basicForm.personality" />
            </el-form-item>

            <el-form-item label="角色信息">
              <el-input v-model="basicForm.characterInfo" type="textarea" :rows="7" />
            </el-form-item>

            <el-form-item label="对话要求">
              <el-input v-model="basicForm.dialogueRequirements" type="textarea" :rows="7" />
            </el-form-item>

            <el-form-item label="高级配置 JSON">
              <el-input v-model="advancedJson" type="textarea" :rows="12" spellcheck="false" />
            </el-form-item>
          </el-form>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.characters-view {
  height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header,
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-header h2,
.editor-toolbar h3 {
  margin: 0;
}

.page-header p,
.editor-toolbar p {
  margin-top: 6px;
  color: #667085;
  font-size: 13px;
}

.header-actions,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
}

.character-list,
.editor {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  min-height: 0;
}

.character-list {
  overflow-y: auto;
  padding: 12px;
}

.list-title {
  padding: 6px 8px 12px;
  color: #667085;
  font-size: 13px;
}

.character-item {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px 10px;
  margin-bottom: 8px;
  align-items: center;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  color: #333;
}

.character-item:hover {
  background: #f6f7fb;
}

.character-item:hover .item-status-icon .is-inactive {
  color: #c0c4cc !important;
}

.character-item.active {
  border-color: #ff6b9d;
  background: #fff3f7;
}

.character-item.current.active {
  box-shadow: inset 3px 0 0 #f56c6c;
}

.item-status-icon {
  grid-column: 1 / 2;
  grid-row: 1 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  transition: all 0.2s;
  margin-right: 4px;
}

.item-status-icon:hover {
  background: rgba(0, 0, 0, 0.05);
}

.item-name {
  grid-column: 2 / 3;
  grid-row: 1 / 2;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  grid-column: 2 / 3;
  grid-row: 2 / 3;
  color: #667085;
  font-size: 12px;
}

.item-tag-live2d {
  grid-column: 3 / 4;
  grid-row: 1 / 2;
  justify-self: end;
}

.item-tag-tts {
  grid-column: 3 / 4;
  grid-row: 2 / 3;
  justify-self: end;
  align-self: center;
}

.editor {
  overflow: auto;
  padding: 18px;
}

.character-form {
  margin-top: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.hidden-input {
  display: none;
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .character-list {
    max-height: 280px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .page-header,
  .editor-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
