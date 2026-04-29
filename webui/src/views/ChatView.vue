<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { stateApi, logApi } from '@/api'
import type { Dialogue, LogEntry } from '@/api'

// 对话相关
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string; time: Date; audioQueue?: any[]; currentSubtitle?: string }>>([])
const inputText = ref('')
const isLoading = ref(false)

// 音频播放相关
const audioQueue = ref<Array<{ base64: string; sentenceIndex: number }>>([])
const currentPlayingIndex = ref(-1)
let audioElement: HTMLAudioElement | null = null
let isAudioPlaying = false

// 字幕队列（等待音频事件触发显示）
// const subtitleQueue = ref<Map<number, { text: string; action?: string }>>(new Map())
// 语音文本队列（等待音频事件触发显示，包含结束标点信息）
// const voiceQueue = ref<Map<number, { text: string; endPunctuation?: 'period' | 'comma' }>>(new Map())

// 流式显示相关
const streamingText = ref('')
const streamingSentenceIndex = ref(-1)
let streamingTimer: number | null = null
const totalSentences = ref(0)

// 字幕流式显示队列（sentenceIndex -> 字幕文本）
const subtitleQueue = ref<Map<number, string>>(new Map())

// 每个句子的结束标点信息（用于音频播放后的停顿）
const sentenceEndPunctuation = ref<Map<number, 'period' | 'comma' | undefined>>(new Map())

// 流式显示完成标志（done事件设置，避免done事件过早清空队列）
const isStreamDone = ref(false)

// 获取结束标点类型
function getEndPunctuation(text: string): 'period' | 'comma' | undefined {
  if (/[。！？!?]$/.test(text)) return 'period'
  if (/[，,、]$/.test(text)) return 'comma'
  return undefined
}

// 上下文调试相关
const debugMode = ref(true)
const contextLogs = ref<Array<{ step: string; data: any; time: Date }>>([])
const conversationHistory = ref<Dialogue[]>([])
const recentLogs = ref<LogEntry[]>([])
const currentState = ref<any>(null)

// 加载初始数据
async function loadInitialData() {
  try {
    const dialogueRes = await stateApi.getDialogues(20)
    conversationHistory.value = dialogueRes.data || []

    const logRes = await logApi.getRecent(100)
    recentLogs.value = logRes.data || []

    const stateRes = await stateApi.get()
    currentState.value = stateRes.data

    messages.value = []
    const sortedHistory = [...conversationHistory.value].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    for (const d of sortedHistory) {
      messages.value.push({
        role: 'user' as const,
        content: d.userContent,
        time: new Date(d.createdAt)
      })
      messages.value.push({
        role: 'assistant' as const,
        content: d.aiContent,
        time: new Date(d.createdAt)
      })
    }

    await nextTick()
    scrollToBottom()
  } catch (e) {
    console.error('Failed to load initial data:', e)
  }
}

// 播放下一句音频
function playNextAudio() {
  // 已在播放中，不打断
  if (isAudioPlaying) return

  if (audioElement) {
    audioElement.pause()
    audioElement = null
  }

  // 找到下一个要播放的句子（不依赖严格+1，按顺序找最小的大于当前播放位置的）
  const currentIdx = currentPlayingIndex.value
  const sortedAudio = [...audioQueue.value].sort((a, b) => a.sentenceIndex - b.sentenceIndex)
  const next = sortedAudio.find(a => a.sentenceIndex > currentIdx)
  if (next) {
    currentPlayingIndex.value = next.sentenceIndex
    audioElement = new Audio(`data:audio/wav;base64,${next.base64}`)
    audioElement.onended = () => {
      isAudioPlaying = false
      const finishedIndex = next.sentenceIndex
      // 获取上一句的结束标点，决定停顿时间
      const endPunct = sentenceEndPunctuation.value.get(finishedIndex)
      const delay = endPunct === 'period' ? 1000 : endPunct === 'comma' ? 500 : 0
      // 用完删除
      sentenceEndPunctuation.value.delete(finishedIndex)
      currentPlayingIndex.value = finishedIndex
      setTimeout(() => {
        playNextAudio()
      }, delay)
    }
    audioElement.onerror = (e) => {
      console.error('Audio playback error:', e)
      isAudioPlaying = false
      playNextAudio()
    }
    isAudioPlaying = true
    audioElement.play()
  }
}

// 发送消息
async function sendMessage() {
  if (!inputText.value.trim() || isLoading.value) return

  const userMessage = inputText.value.trim()
  inputText.value = ''
  isLoading.value = true

  // 添加用户消息
  messages.value.push({
    role: 'user',
    content: userMessage,
    time: new Date()
  })

  contextLogs.value = []
  addContextLog('用户输入', { message: userMessage })

  await nextTick()
  scrollToBottom()

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: userMessage })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    // 添加角色消息占位
    messages.value.push({
      role: 'assistant',
      content: '',
      time: new Date(),
      audioQueue: [],
      currentSubtitle: ''
    })

    // 重置播放状态
    audioQueue.value = []
    currentPlayingIndex.value = -1
    isAudioPlaying = false
    if (audioElement) {
      audioElement.pause()
      audioElement = null
    }
    // subtitleQueue.value.clear()
    // voiceQueue.value.clear()
    streamingText.value = ''
    streamingSentenceIndex.value = -1
    if (streamingTimer) {
      clearTimeout(streamingTimer)
      streamingTimer = null
    }
    subtitleQueue.value.clear()
    totalSentences.value = 0
    sentenceEndPunctuation.value.clear()
    isStreamDone.value = false

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventType = ''

    if (!reader) {
      throw new Error('No response body')
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim()
          continue
        }
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (!data) continue

          addContextLog(`收到${eventType || 'text'}事件`, { data })

          if (eventType === 'text') {
            const lastMsg = messages.value[messages.value.length - 1]
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content += data
            }
            scrollToBottom()
          } else if (eventType === 'voice') {
            // voice事件：记录结束标点，追加文本到 content
            try {
              const voiceData = JSON.parse(data)
              const sentenceIndex = voiceData.sentenceIndex || 0
              totalSentences.value = voiceData.totalSentences || 0

              // 追加 voice 文本到 message content
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content += voiceData.text || ''
              }

              // 记录结束标点信息
              sentenceEndPunctuation.value.set(sentenceIndex, getEndPunctuation(voiceData.text || ''))
            } catch (e) {
              console.error('Failed to parse voice data:', e)
            }
          } else if (eventType === 'subtitle') {
            // subtitle事件：剥离 ACTION 标签，触发字幕流式显示
            try {
              const subData = JSON.parse(data)
              const text = (subData.text || '').replace(/\[ACTION:[^\]]+\]/g, '')
              const sentenceIndex = subData.sentenceIndex || 0

              // 触发流式显示字幕
              startStreamingText(text, sentenceIndex)
            } catch (e) {
              console.error('Failed to parse subtitle data:', e)
            }
          } else if (eventType === 'subtitle_extra') {
            // subtitle_extra事件：多余字幕，立即显示（不走audio同步）
            try {
              const subData = JSON.parse(data)
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.currentSubtitle += subData.text || ''
              }
            } catch (e) {
              console.error('Failed to parse subtitle_extra data:', e)
            }
          } else if (eventType === 'audio') {
            // audio事件：缓存音频，尝试播放
            try {
              const audioData = JSON.parse(data)
              const sentenceIndex = audioData.sentenceIndex
              audioQueue.value.push({
                base64: audioData.audio,
                sentenceIndex: sentenceIndex
              })
              // 按sentenceIndex排序
              audioQueue.value.sort((a, b) => a.sentenceIndex - b.sentenceIndex)

              // 尝试播放
              playNextAudio()
            } catch (e) {
              console.error('Failed to parse audio data:', e)
            }
          } else if (eventType === 'action') {
            // action事件：播放Live2D动作（暂未实现）
            try {
              const actionData = JSON.parse(data)
              addContextLog('收到action事件', actionData)
            } catch (e) {
              console.error('Failed to parse action data:', e)
            }
          } else if (eventType === 'done') {
            // done事件：设置标志，让当前字幕流式显示完成后统一flush
            isStreamDone.value = true
            // 不再这里 clearTimeout 和 flush，等待流式显示自然结束
          }
        }
      }
    }

    addContextLog('对话完成', {})
    isLoading.value = false
    refreshData()

  } catch (error) {
    console.error('Chat error:', error)
    addContextLog('错误', { error: String(error) })
    isLoading.value = false
  }
}

// 添加上下文日志
function addContextLog(step: string, data: any) {
  // 音频数据只保留哈希值，避免日志过大
  let logData = data

  // data 是 SSE 事件解析后的原始数据
  // 格式可能是：
  // 1. 对象 { data: "..." } — 经过 JSON.parse 的
  // 2. 字符串 "{audio:..., sentenceIndex:...}" — 原始 data 字段
  // 3. 对象 { audio: "...", sentenceIndex: ... } — 直接就是 audio 对象

  try {
    if (typeof data === 'string') {
      // 如果是 JSON 字符串，尝试解析后检查
      const parsed = JSON.parse(data)
      if (parsed && parsed.audio) {
        logData = { audio: `[audio:${hashCode(parsed.audio.slice(0, 100))}]` }
      }
    } else if (data && typeof data === 'object') {
      if (data.audio) {
        // data.audio 直接是 base64 字符串
        logData = { audio: `[audio:${hashCode(String(data.audio).slice(0, 100))}]` }
      } else if (data.data && typeof data.data === 'string') {
        // data.data 是字符串，进一步检查
        if (data.data.startsWith('{')) {
          try {
            const inner = JSON.parse(data.data)
            if (inner.audio) {
              logData = { data: { audio: `[audio:${hashCode(inner.audio.slice(0, 100))}]` } }
            }
          } catch {
            // 不是 JSON，保持原样
          }
        } else if (data.data.startsWith('audio')) {
          logData = { data: `[audio:${hashCode(data.data.slice(0, 100))}]` }
        }
      }
    }
  } catch {
    // 解析失败，保持原样
  }

  contextLogs.value.push({
    step,
    data: logData,
    time: new Date()
  })
}

// 简单哈希函数
function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

// 流式显示文本（标点停顿）
function startStreamingText(text: string, sentenceIndex: number) {
  const lastMsg = messages.value[messages.value.length - 1]
  if (!lastMsg || lastMsg.role !== 'assistant') return

  // 如果done事件已触发，直接flush，不再逐字显示
  if (isStreamDone.value) {
    lastMsg.currentSubtitle += text
    return
  }

  // 如果正在显示另一个句子，将当前句子加入队列
  if (streamingTimer !== null && streamingSentenceIndex.value !== sentenceIndex) {
    subtitleQueue.value.set(sentenceIndex, text)
    return
  }

  // 停止之前的流式显示
  if (streamingTimer) {
    clearTimeout(streamingTimer)
    streamingTimer = null
  }

  streamingSentenceIndex.value = sentenceIndex
  streamingText.value = ''

  let charIndex = 0
  const chars = text.split('')
  const BASE_DELAY = 200 // 每字符基础延迟(ms)

  function displayNextChar() {
    if (charIndex < chars.length) {
      const currentChar = chars[charIndex]
      streamingText.value += currentChar
      lastMsg.currentSubtitle += currentChar
      charIndex++

      // 根据字符类型调整延迟
      let delay = BASE_DELAY
      if (/[。！？!?]/.test(currentChar)) {
        delay = BASE_DELAY * 4  // 句号停4倍
      } else if (/[，,]/.test(currentChar)) {
        delay = BASE_DELAY * 2  // 逗号停2倍
      } else if (/[、]/.test(currentChar)) {
        delay = BASE_DELAY * 1.5  // 顿号停1.5倍
      }

      streamingTimer = window.setTimeout(displayNextChar, delay)
    } else {
      // 流式显示完成，处理队列中的下一个
      streamingText.value = ''
      streamingSentenceIndex.value = -1
      streamingTimer = null

      // 处理队列中的下一个字幕
      processSubtitleQueue()
    }
  }

  displayNextChar()
}

// 处理字幕队列
function processSubtitleQueue() {
  if (subtitleQueue.value.size === 0) return

  // 如果done事件已触发，直接flush剩余字幕，不再逐字显示
  if (isStreamDone.value) {
    const lastMsg = messages.value[messages.value.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      const sortedEntries = [...subtitleQueue.value.entries()].sort((a, b) => a[0] - b[0])
      for (const [, text] of sortedEntries) {
        lastMsg.currentSubtitle += text
      }
    }
    subtitleQueue.value.clear()
    return
  }

  // 找出下一个要显示的字幕（按 sentenceIndex 排序）
  const sortedEntries = [...subtitleQueue.value.entries()].sort((a, b) => a[0] - b[0])
  const [nextIndex, nextText] = sortedEntries[0]

  subtitleQueue.value.delete(nextIndex)
  startStreamingText(nextText, nextIndex)
}

// 刷新数据
async function refreshData() {
  try {
    const [dialogueRes, logRes, stateRes] = await Promise.all([
      stateApi.getDialogues(20),
      logApi.getRecent(100),
      stateApi.get()
    ])
    conversationHistory.value = dialogueRes.data || []
    recentLogs.value = logRes.data || []
    currentState.value = stateRes.data
  } catch (e) {
    console.error('Failed to refresh data:', e)
  }
}

// 滚动到底部
function scrollToBottom() {
  requestAnimationFrame(() => {
    const container = document.querySelector('.messages-container')
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  })
}

// 格式化时间
function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// 获取日志级别样式
function getLogLevelClass(level: string): string {
  return `log-${level}`
}

onMounted(() => {
  loadInitialData()
})

watch(() => messages.value.length, async () => {
  await nextTick()
  scrollToBottom()
})
</script>

<template>
  <div class="chat-view">
    <div class="chat-main">
      <div class="chat-header">
        <h2>对话测试</h2>
        <div class="header-actions">
          <label class="debug-toggle">
            <input type="checkbox" v-model="debugMode" />
            <span>调试模式</span>
          </label>
          <button class="btn-refresh" @click="refreshData">刷新数据</button>
        </div>
      </div>

      <!-- 对话区域 -->
      <div class="messages-container">
        <div v-if="messages.length === 0" class="empty-state">
          暂无对话记录，开始对话吧
        </div>
        <div
          v-for="(msg, index) in messages"
          :key="index"
          class="message"
          :class="msg.role"
        >
          <div class="message-header">
            <span class="role-label">{{ msg.role === 'user' ? '用户' : '角色' }}</span>
            <span class="time">{{ formatTime(msg.time) }}</span>
          </div>
          <div class="message-content">{{ msg.content }}</div>
          <!-- 字幕显示 -->
          <div v-if="msg.role === 'assistant' && msg.currentSubtitle" class="message-subtitle">
            {{ msg.currentSubtitle }}<span class="blink-cursor">|</span>
          </div>
        </div>
      </div>

      <!-- 输入区域 -->
      <div class="input-area">
        <input
          v-model="inputText"
          type="text"
          placeholder="输入消息..."
          :disabled="isLoading"
          @keyup.enter="sendMessage"
        />
        <button @click="sendMessage" :disabled="isLoading || !inputText.trim()">
          {{ isLoading ? '发送中...' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 调试面板 -->
    <div class="debug-panel" v-if="debugMode">
      <div class="debug-section">
        <h3>上下文日志</h3>
        <div class="context-logs">
          <div
            v-for="(log, index) in contextLogs"
            :key="index"
            class="context-log-item"
          >
            <div class="log-header">
              <span class="step">{{ log.step }}</span>
              <span class="time">{{ formatTime(log.time) }}</span>
            </div>
            <pre class="log-data">{{ JSON.stringify(log.data, null, 2) }}</pre>
          </div>
          <div v-if="contextLogs.length === 0" class="empty-logs">
            暂无上下文日志
          </div>
        </div>
      </div>

      <div class="debug-section">
        <h3>当前状态</h3>
        <div class="state-display" v-if="currentState">
          <div class="state-group">
            <h4>好感度</h4>
            <div v-for="(value, key) in currentState.affinity.dimensions" :key="key" class="state-row">
              <span>{{ key }}:</span>
              <span>{{ value }}</span>
            </div>
          </div>
          <div class="state-group">
            <h4>情绪</h4>
            <div v-for="(value, key) in currentState.emotion.dimensions" :key="key" class="state-row">
              <span>{{ key }}:</span>
              <span>{{ value }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="debug-section">
        <h3>音频队列</h3>
        <div class="audio-queue">
          <div v-if="audioQueue.length === 0" class="empty-audio">暂无音频</div>
          <div v-for="audio in audioQueue" :key="audio.sentenceIndex" class="audio-item">
            <span class="audio-index">{{ audio.sentenceIndex }}</span>
            <span :class="{ playing: audio.sentenceIndex === currentPlayingIndex }">●</span>
          </div>
        </div>
        <div class="audio-status">
          当前播放: {{ currentPlayingIndex }}
        </div>
      </div>

      <div class="debug-section">
        <h3>近期日志</h3>
        <div class="logs-list">
          <div
            v-for="log in recentLogs.slice(0, 30)"
            :key="log.id"
            class="log-item"
            :class="getLogLevelClass(log.level)"
          >
            <span class="log-time">{{ new Date(log.createdAt).toLocaleTimeString() }}</span>
            <span class="log-category">[{{ log.category }}]</span>
            <span class="log-content">{{ log.content.substring(0, 100) }}</span>
          </div>
        </div>
      </div>

      <div class="debug-section">
        <h3>对话历史 (共 {{ conversationHistory.length }} 条)</h3>
        <div class="history-list">
          <div
            v-for="dialog in conversationHistory"
            :key="dialog.id"
            class="history-item"
          >
            <div class="history-turn">#{{ dialog.turnIndex }}</div>
            <div class="history-content">
              <div class="user-msg">{{ dialog.userContent }}</div>
              <div class="ai-msg">{{ dialog.aiContent }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  gap: 20px;
  height: calc(100vh - 48px);
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  overflow: hidden;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.chat-header h2 {
  font-size: 18px;
}

.header-actions {
  display: flex;
  gap: 16px;
  align-items: center;
}

.debug-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-refresh {
  padding: 6px 12px;
  background: #f5f5f5;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.btn-refresh:hover {
  background: #eee;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.empty-state {
  text-align: center;
  color: #999;
  padding: 40px;
}

.message {
  margin-bottom: 16px;
  max-width: 80%;
}

.message.user {
  margin-left: auto;
}

.message.assistant {
  margin-right: auto;
}

.message-header {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}

.role-label {
  font-weight: 500;
}

.message.user .role-label {
  color: #2196f3;
}

.message.assistant .role-label {
  color: #ff6b9d;
}

.time {
  color: #999;
}

.message-content {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.message.user .message-content {
  background: #e3f2fd;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  background: #fce4ec;
  border-bottom-left-radius: 4px;
}

.message-subtitle {
  padding: 8px 16px;
  margin-top: 4px;
  font-size: 14px;
  color: #666;
  background: rgba(255, 107, 157, 0.1);
  border-radius: 8px;
}

.blink-cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.input-area {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #eee;
}

.input-area input {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #eee;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}

.input-area input:focus {
  border-color: #ff6b9d;
}

.input-area button {
  padding: 12px 24px;
  background: #ff6b9d;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.input-area button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

/* Debug Panel */
.debug-panel {
  width: 450px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.debug-section {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 16px;
}

.debug-section h3 {
  font-size: 14px;
  color: #666;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}

.context-logs {
  max-height: 300px;
  overflow-y: auto;
}

.context-log-item {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f5f5f5;
}

.context-log-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.log-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.step {
  font-weight: 500;
  color: #ff6b9d;
  font-size: 13px;
}

.log-data {
  background: #f9f9f9;
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
}

.empty-logs {
  color: #999;
  font-size: 13px;
  text-align: center;
  padding: 20px;
}

.state-display {
  display: flex;
  gap: 20px;
}

.state-group h4 {
  font-size: 12px;
  color: #888;
  margin-bottom: 6px;
}

.state-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  margin-bottom: 4px;
}

.state-row span:first-child {
  color: #666;
}

.audio-queue {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.empty-audio {
  color: #999;
  font-size: 12px;
}

.audio-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 11px;
}

.audio-item .playing {
  color: #ff6b9d;
}

.audio-status {
  font-size: 11px;
  color: #666;
}

.logs-list {
  max-height: 200px;
  overflow-y: auto;
  font-size: 11px;
}

.log-item {
  padding: 4px 0;
  border-bottom: 1px solid #f5f5f5;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.log-time {
  color: #999;
  flex-shrink: 0;
}

.log-category {
  color: #666;
  flex-shrink: 0;
}

.log-content {
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-info { border-left: 3px solid #2196f3; }
.log-warn { border-left: 3px solid #ff9800; }
.log-error { border-left: 3px solid #f44336; }
.log-debug { border-left: 3px solid #9e9e9e; }

.history-list {
  max-height: 250px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f5f5f5;
}

.history-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.history-turn {
  font-size: 11px;
  color: #999;
  flex-shrink: 0;
}

.history-content {
  flex: 1;
  font-size: 12px;
}

.user-msg {
  color: #2196f3;
  margin-bottom: 4px;
}

.ai-msg {
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
