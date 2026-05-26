// live2d-chat.js - 桌宠对话功能模块
// 处理 SSE 通信、字幕流式显示、音频播放

(function() {
    'use strict';

    const API_BASE = '';

    // 音频播放相关状态
    let audioQueue = [];
    let currentPlayingIndex = -1;
    let audioElement = null;
    let isAudioPlaying = false;

    // 字幕相关状态
    let messageEls = [];              // 可见的消息DOM元素（最多3条）
    let currentMsgEl = null;          // 当前正在接收的消息元素
    let needNewMsgEl = true;          // 是否需要为下一条subtitle创建新元素
    let subtitleQueue = new Map();    // 句子级流式队列
    let sentenceEndPunctuation = new Map();
    let streamingTimer = null;
    let streamingSentenceIndex = -1;
    let isStreamDone = false;
    let subtitleClearTimer = null;
    const MAX_MESSAGES = 3;
    const CLEAR_TIMEOUT = 10000;      // 10秒无新消息则清屏

    function resetSubtitleClearTimer() {
        if (subtitleClearTimer) clearTimeout(subtitleClearTimer);
        subtitleClearTimer = setTimeout(clearAllSubtitles, CLEAR_TIMEOUT);
    }

    function clearAllSubtitles() {
        var container = document.getElementById('subtitle-text');
        if (container) {
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
        }
        messageEls = [];
        currentMsgEl = null;
        needNewMsgEl = true;
    }

    function createMessageElement() {
        var container = document.getElementById('subtitle-text');
        if (!container) return null;

        // 超出上限时移除最早的
        while (messageEls.length >= MAX_MESSAGES) {
            var oldest = messageEls.shift();
            if (oldest.parentNode) {
                oldest.parentNode.removeChild(oldest);
            }
        }

        var el = document.createElement('p');
        el.className = 'subtitle-msg';
        container.appendChild(el);
        messageEls.push(el);
        return el;
    }

    function getCurrentMsgEl() {
        if (needNewMsgEl) {
            currentMsgEl = createMessageElement();
            needNewMsgEl = false;
        }
        return currentMsgEl;
    }

    // 获取结束标点类型
    function getEndPunctuation(text) {
        if (/[。！？!?]$/.test(text)) return 'period';
        if (/[，,、]$/.test(text)) return 'comma';
        return undefined;
    }

    // 播放下一句音频
    function playNextAudio() {
        if (isAudioPlaying) return;
        if (audioElement) {
            audioElement.pause();
            audioElement = null;
        }
        const sortedAudio = audioQueue.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
        const next = sortedAudio.find(a => a.sentenceIndex > currentPlayingIndex);
        if (next) {
            currentPlayingIndex = next.sentenceIndex;
            audioElement = new Audio(`data:audio/wav;base64,${next.base64}`);
            audioElement.onended = function() {
                isAudioPlaying = false;
                const finishedIndex = next.sentenceIndex;
                const endPunct = sentenceEndPunctuation.get(finishedIndex);
                const delay = endPunct === 'period' ? 1000 : endPunct === 'comma' ? 500 : 0;
                sentenceEndPunctuation.delete(finishedIndex);
                currentPlayingIndex = finishedIndex;
                setTimeout(playNextAudio, delay);
            };
            audioElement.onerror = function(e) {
                console.error('Audio playback error:', e);
                isAudioPlaying = false;
                playNextAudio();
            };
            isAudioPlaying = true;
            audioElement.play();
        }
    }

    // 流式显示文本（标点停顿）
    function startStreamingText(text, sentenceIndex) {
        const subtitleEl = getCurrentMsgEl();
        if (!subtitleEl) return;

        // 如果done事件已触发，直接flush
        if (isStreamDone) {
            subtitleEl.textContent += text;
            return;
        }

        // 如果正在显示另一个句子，加入队列
        if (streamingTimer !== null && streamingSentenceIndex !== sentenceIndex) {
            subtitleQueue.set(sentenceIndex, text);
            return;
        }

        // 停止之前的流式显示
        if (streamingTimer) {
            clearTimeout(streamingTimer);
            streamingTimer = null;
        }

        streamingSentenceIndex = sentenceIndex;
        let charIndex = 0;
        const chars = text.split('');
        const BASE_DELAY = 200;

        function displayNextChar() {
            if (charIndex < chars.length) {
                const currentChar = chars[charIndex];
                subtitleEl.textContent += currentChar;
                charIndex++;

                let delay = BASE_DELAY;
                if (/[。！？!?]/.test(currentChar)) {
                    delay = BASE_DELAY * 4;
                } else if (/[，,]/.test(currentChar)) {
                    delay = BASE_DELAY * 2;
                } else if (/[、]/.test(currentChar)) {
                    delay = BASE_DELAY * 1.5;
                }

                streamingTimer = setTimeout(displayNextChar, delay);
            } else {
                streamingTimer = null;
                streamingSentenceIndex = -1;
                resetSubtitleClearTimer();
                processSubtitleQueue();
            }
        }

        displayNextChar();
    }

    // 处理字幕队列
    function processSubtitleQueue() {
        if (subtitleQueue.size === 0) return;

        if (isStreamDone) {
            const subtitleEl = getCurrentMsgEl();
            if (subtitleEl) {
                const sortedEntries = [...subtitleQueue.entries()].sort((a, b) => a[0] - b[0]);
                for (const [, text] of sortedEntries) {
                    subtitleEl.textContent += text;
                }
            }
            subtitleQueue.clear();
            return;
        }

        const sortedEntries = [...subtitleQueue.entries()].sort((a, b) => a[0] - b[0]);
        const [nextIndex, nextText] = sortedEntries[0];
        subtitleQueue.delete(nextIndex);
        startStreamingText(nextText, nextIndex);
    }

    // 处理单条 SSE 事件（chat 和 proactive 共用）
    function handleSSEEvent(eventType, data) {
        console.log('SSE event:', eventType, 'data:', data.substring(0, 100));

        if (eventType === 'voice') {
            try {
                const voiceData = JSON.parse(data);
                const sentenceIndex = voiceData.sentenceIndex || 0;
                sentenceEndPunctuation.set(sentenceIndex, getEndPunctuation(voiceData.text || ''));
            } catch (e) { console.error('voice parse error:', e); }
        } else if (eventType === 'subtitle') {
            try {
                const subData = JSON.parse(data);
                const text = (subData.text || '').replace(/\[ACTION:[^\]]+\]/g, '');
                const sentenceIndex = subData.sentenceIndex || 0;
                resetSubtitleClearTimer();
                startStreamingText(text, sentenceIndex);
            } catch (e) { console.error('subtitle parse error:', e); }
        } else if (eventType === 'subtitle_extra') {
            try {
                const subData = JSON.parse(data);
                var extraEl = getCurrentMsgEl();
                if (extraEl) extraEl.textContent += subData.text || '';
                resetSubtitleClearTimer();
            } catch (e) { console.error('subtitle_extra parse error:', e); }
        } else if (eventType === 'audio') {
            try {
                const audioData = JSON.parse(data);
                audioQueue.push({
                    base64: audioData.audio,
                    sentenceIndex: audioData.sentenceIndex
                });
                audioQueue.sort(function(a, b) { return a.sentenceIndex - b.sentenceIndex; });
                playNextAudio();
            } catch (e) { console.error('audio parse error:', e); }
        } else if (eventType === 'done') {
            isStreamDone = true;
            needNewMsgEl = true;
            processSubtitleQueue();
        } else if (eventType === 'error') {
            try {
                const errData = JSON.parse(data);
                console.error('Proactive error:', errData.message);
                var errEl = createMessageElement();
                if (errEl) errEl.textContent = errData.message || '未知错误';
            } catch (e) { console.error('error event parse:', e); }
        }
    }

    // 建立 proactive SSE 长连接
    let proactiveEventSource = null;

    function connectProactiveStream() {
        if (proactiveEventSource) {
            proactiveEventSource.close();
        }

        console.log('Connecting proactive SSE stream...');
        proactiveEventSource = new EventSource(API_BASE + '/api/proactive/stream');

        proactiveEventSource.addEventListener('voice', function(e) {
            handleSSEEvent('voice', e.data);
        });
        proactiveEventSource.addEventListener('subtitle', function(e) {
            handleSSEEvent('subtitle', e.data);
        });
        proactiveEventSource.addEventListener('audio', function(e) {
            handleSSEEvent('audio', e.data);
        });
        proactiveEventSource.addEventListener('done', function(e) {
            handleSSEEvent('done', e.data);
        });
        proactiveEventSource.addEventListener('error', function(e) {
            if (e.data) {
                handleSSEEvent('error', e.data);
            }
            console.log('Proactive SSE stream error (will reconnect)', e.target.readyState);
        });

        proactiveEventSource.onerror = function() {
            // EventSource 会自动重连，但太频繁时手动延迟
            console.log('Proactive SSE connection lost, reconnecting in 5s...');
            proactiveEventSource.close();
            proactiveEventSource = null;
            setTimeout(connectProactiveStream, 5000);
        };
    }

    // 发送消息
    async function sendMessage() {
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send-btn');
        if (!input || !input.value.trim() || isAudioPlaying) return;

        const userMessage = input.value.trim();
        input.value = '';
        sendBtn.disabled = true;

        // 清空字幕
        clearAllSubtitles();
        if (subtitleClearTimer) {
            clearTimeout(subtitleClearTimer);
            subtitleClearTimer = null;
        }

        // 重置播放状态
        audioQueue = [];
        currentPlayingIndex = -1;
        isAudioPlaying = false;
        if (audioElement) {
            audioElement.pause();
            audioElement = null;
        }
        subtitleQueue.clear();
        sentenceEndPunctuation.clear();
        if (streamingTimer) {
            clearTimeout(streamingTimer);
            streamingTimer = null;
        }
        streamingSentenceIndex = -1;
        isStreamDone = false;
        needNewMsgEl = true;
        currentMsgEl = null;

        try {
            console.log('Sending message:', userMessage);
            const response = await fetch(API_BASE + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage })
            });

            console.log('Response status:', response.status);
            if (!response.ok) throw new Error('HTTP ' + response.status);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let eventType = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        eventType = line.slice(6).trim();
                        continue;
                    }
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim();
                        if (!data) continue;
                        handleSSEEvent(eventType, data);
                    }
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
            clearAllSubtitles();
            var errEl = createMessageElement();
            if (errEl) errEl.textContent = '错误: ' + error.message;
        } finally {
            sendBtn.disabled = false;
        }
    }

    // 绑定事件
    function initChat() {
        console.log('Initializing chat module...');

        const sendBtn = document.getElementById('chat-send-btn');
        const input = document.getElementById('chat-input');

        console.log('sendBtn:', sendBtn);
        console.log('input:', input);

        if (sendBtn) {
            sendBtn.addEventListener('click', function() {
                console.log('Send button clicked');
                sendMessage();
            });
        } else {
            console.error('sendBtn not found');
        }

        if (input) {
            input.addEventListener('keyup', function(e) {
                console.log('Key up:', e.key);
                if (e.key === 'Enter') sendMessage();
            });
        } else {
            console.error('chat-input not found');
        }

        connectProactiveStream();

        console.log('Live2D chat module initialized');
    }

    // 页面加载完成后初始化
    console.log('live2d-chat.js loaded, readyState:', document.readyState);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        // DOM already loaded
        initChat();
    }

    // 暴露给全局，方便调试
    window.live2dChat = {
        sendMessage: sendMessage,
        isPlaying: function() { return isAudioPlaying; }
    };

})();