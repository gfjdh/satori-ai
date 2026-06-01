// live2d-voice.js - 语音识别模块
// RMS VAD + ASR 转录 + 自动发送
(function() {
    'use strict';

    const API_BASE = '';

    // ── State ──
    let audioContext = null;
    let mediaStream = null;
    let scriptProcessor = null;
    let analyserNode = null;
    let isActive = false;

    // Config
    let autoSend = true;
    let silenceTimeout = 1.5; // seconds
    let rmsThreshold = 0.02;  // RMS energy threshold for speech detection

    // VAD state machine
    const VAD_IDLE = 'idle';
    const VAD_SPEAKING = 'speaking';
    const VAD_SILENCE_WAIT = 'silence_wait';
    let vadState = VAD_IDLE;
    let pcmChunks = [];
    let silenceStartTime = 0;
    let speechDetected = false;

    // UI elements
    let micIndicator = null;
    let countdownTimer = null;
    let updateInterval = null;

    // ── UI: Mic Indicator ──
    function createMicIndicator() {
        if (micIndicator) return;
        micIndicator = document.createElement('div');
        micIndicator.id = 'mic-indicator';
        micIndicator.title = '语音对话已开启';
        micIndicator.innerHTML = '🎤';
        micIndicator.style.cssText =
            'position:fixed;bottom:60px;right:16px;width:36px;height:36px;' +
            'border-radius:50%;background:rgba(0,0,0,0.5);color:#fff;' +
            'display:flex;align-items:center;justify-content:center;' +
            'font-size:18px;z-index:10000;cursor:pointer;transition:all 0.3s;';
        micIndicator.addEventListener('click', stop);
        document.body.appendChild(micIndicator);
    }

    function removeMicIndicator() {
        if (micIndicator) {
            micIndicator.remove();
            micIndicator = null;
        }
        clearCountdown();
    }

    function setMicState(state) {
        if (!micIndicator) return;
        switch (state) {
            case 'idle':
                micIndicator.style.animation = 'none';
                micIndicator.style.boxShadow = 'none';
                break;
            case 'listening':
                micIndicator.style.animation = 'mic-pulse 1.5s ease-in-out infinite';
                micIndicator.style.boxShadow = '0 0 8px rgba(255,105,180,0.6)';
                break;
            case 'processing':
                micIndicator.style.animation = 'mic-spin 0.8s linear infinite';
                micIndicator.style.boxShadow = '0 0 12px rgba(255,165,0,0.8)';
                break;
            case 'error':
                micIndicator.style.animation = 'mic-blink 0.3s ease-in-out 3';
                micIndicator.style.boxShadow = '0 0 12px rgba(255,0,0,0.8)';
                setTimeout(function() { setMicState('listening'); }, 1000);
                break;
        }
    }

    function clearCountdown() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    function showCountdown(seconds) {
        clearCountdown();
        if (!micIndicator) return;
        var remaining = seconds;
        micIndicator.innerHTML = (remaining * 10).toFixed(0);
        countdownTimer = setInterval(function() {
            remaining -= 0.1;
            if (remaining <= 0) {
                clearCountdown();
                micIndicator.innerHTML = '🎤';
            } else {
                micIndicator.innerHTML = (remaining * 10).toFixed(0);
            }
        }, 100);
    }

    // ── Audio Setup ──
    async function setupAudio() {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });

        var source = audioContext.createMediaStreamSource(mediaStream);

        // Analyser for RMS calculation
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 1024;
        analyserNode.smoothingTimeConstant = 0.3;
        source.connect(analyserNode);

        // ScriptProcessor for PCM capture
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        // RMS analysis (from analyser)
        var rmsData = new Float32Array(analyserNode.fftSize);

        scriptProcessor.onaudioprocess = function(event) {
            if (!isActive) return;

            // Get RMS from analyser
            analyserNode.getFloatTimeDomainData(rmsData);
            var sumSq = 0;
            for (var i = 0; i < rmsData.length; i++) {
                sumSq += rmsData[i] * rmsData[i];
            }
            var rms = Math.sqrt(sumSq / rmsData.length);

            // Get PCM from input
            var inputData = event.inputBuffer.getChannelData(0);
            var pcmCopy = new Float32Array(inputData.length);
            pcmCopy.set(inputData);

            processVAD(rms, pcmCopy);
        };
    }

    // ── VAD State Machine ──
    function processVAD(rms, pcmData) {
        switch (vadState) {
            case VAD_IDLE:
                if (rms > rmsThreshold) {
                    vadState = VAD_SPEAKING;
                    pcmChunks = [pcmData];
                    speechDetected = true;
                    setMicState('listening');
                }
                break;

            case VAD_SPEAKING:
                pcmChunks.push(pcmData);
                if (rms < rmsThreshold) {
                    vadState = VAD_SILENCE_WAIT;
                    silenceStartTime = performance.now();
                    showCountdown(silenceTimeout);
                }
                break;

            case VAD_SILENCE_WAIT:
                // Still collecting during silence (don't cut off abruptly)
                pcmChunks.push(pcmData);
                var elapsed = (performance.now() - silenceStartTime) / 1000;

                if (rms > rmsThreshold) {
                    // User started speaking again
                    vadState = VAD_SPEAKING;
                    clearCountdown();
                    setMicState('listening');
                } else if (elapsed >= silenceTimeout && speechDetected) {
                    // Utterance complete
                    var capturedPcm = concatenateFloat32Arrays(pcmChunks);
                    pcmChunks = [];
                    speechDetected = false;
                    vadState = VAD_IDLE;
                    clearCountdown();
                    processUtterance(capturedPcm);
                }
                break;
        }
    }

    function concatenateFloat32Arrays(arrays) {
        var totalLen = 0;
        for (var i = 0; i < arrays.length; i++) totalLen += arrays[i].length;
        var result = new Float32Array(totalLen);
        var offset = 0;
        for (var i = 0; i < arrays.length; i++) {
            result.set(arrays[i], offset);
            offset += arrays[i].length;
        }
        return result;
    }

    // ── WAV Encoding ──
    function encodeWAV(pcmData, sampleRate, numChannels) {
        sampleRate = sampleRate || 16000;
        numChannels = numChannels || 1;
        var bitsPerSample = 16;
        var byteRate = sampleRate * numChannels * bitsPerSample / 8;
        var blockAlign = numChannels * bitsPerSample / 8;
        var dataLen = pcmData.length * 2; // 16-bit

        var buffer = new ArrayBuffer(44 + dataLen);
        var view = new DataView(buffer);

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLen, true);
        writeString(view, 8, 'WAVE');
        // fmt chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);       // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        // data chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataLen, true);

        // Write PCM samples (clamped to [-1, 1])
        var offset = 44;
        for (var i = 0; i < pcmData.length; i++) {
            var s = Math.max(-1, Math.min(1, pcmData[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    function writeString(view, offset, str) {
        for (var i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    // ── ASR Call ──
    async function processUtterance(pcmData) {
        setMicState('processing');

        try {
            var audioCtxForEncode = audioContext;
            var wavBlob = encodeWAV(pcmData, audioCtxForEncode ? audioCtxForEncode.sampleRate : 16000, 1);

            var resp = await fetch(API_BASE + '/api/voice/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: wavBlob
            });

            if (!resp.ok) {
                var errData = await resp.json().catch(function() { return {}; });
                throw new Error(errData.error || 'HTTP ' + resp.status);
            }

            var result = await resp.json();
            if (!result.success) {
                throw new Error(result.error || 'Transcription failed');
            }

            // Echo to input
            var inputEl = document.getElementById('chat-input');
            if (inputEl && result.text) {
                inputEl.value = result.text;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.focus();
            }

            // Auto-send
            if (autoSend && result.text && result.text.trim()) {
                setTimeout(function() {
                    if (window.live2dChat && typeof window.live2dChat.sendMessage === 'function') {
                        window.live2dChat.sendMessage();
                    }
                }, 300);
            }

            setMicState('listening');
        } catch (e) {
            console.error('Voice transcribe error:', e);
            setMicState('error');
        }
    }

    // ── Public API ──
    async function start() {
        if (isActive) return;
        try {
            await setupAudio();
            isActive = true;
            vadState = VAD_IDLE;
            createMicIndicator();
            setMicState('idle');
            // Pulse after short delay (audio context ready)
            setTimeout(function() { if (isActive) setMicState('listening'); }, 500);
            console.log('Voice recognition started');
        } catch (e) {
            console.error('Failed to start voice recognition:', e);
            isActive = false;
            removeMicIndicator();
            throw e;
        }
    }

    function stop() {
        isActive = false;
        vadState = VAD_IDLE;
        pcmChunks = [];
        clearCountdown();
        removeMicIndicator();

        if (scriptProcessor) {
            scriptProcessor.disconnect();
            scriptProcessor = null;
        }
        if (analyserNode) {
            analyserNode.disconnect();
            analyserNode = null;
        }
        if (audioContext) {
            audioContext.close().catch(function() {});
            audioContext = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(function(t) { t.stop(); });
            mediaStream = null;
        }
        console.log('Voice recognition stopped');
    }

    function setConfig(cfg) {
        if (typeof cfg.autoSend === 'boolean') autoSend = cfg.autoSend;
        if (typeof cfg.silenceTimeout === 'number') silenceTimeout = cfg.silenceTimeout;
        if (typeof cfg.rmsThreshold === 'number') rmsThreshold = cfg.rmsThreshold;
    }

    function isVoiceActive() {
        return isActive;
    }

    // ── Export ──
    window.live2dVoice = {
        start: start,
        stop: stop,
        setConfig: setConfig,
        isActive: isVoiceActive
    };

    // ── Voice Settings Panel ──
    var voiceOverlay = document.getElementById('voice-settings-overlay');
    var voiceToggleEnabled = document.getElementById('toggle-voice-enabled');
    var voiceToggleAutosend = document.getElementById('toggle-voice-autosend');
    var voiceRangeSilence = document.getElementById('range-silence-timeout');
    var voiceDispSilence = document.getElementById('disp-silence');
    var voiceValSilence = document.getElementById('val-silence');

    function showVoiceSettings() {
        loadVoiceConfig().then(function() {
            voiceOverlay.classList.add('visible');
        });
    }

    function hideVoiceSettings() {
        voiceOverlay.classList.remove('visible');
    }

    async function loadVoiceConfig() {
        try {
            var resp = await fetch(API_BASE + '/api/voice/config');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var cfg = await resp.json();
            autoSend = cfg.autoSend !== false;
            silenceTimeout = cfg.silenceTimeout || 1.5;
            voiceToggleEnabled.className = 'toggle' + (cfg.enabled === true ? ' on' : '');
            voiceToggleAutosend.className = 'toggle' + (autoSend ? ' on' : '');
            voiceRangeSilence.value = Math.round(silenceTimeout * 10);
            updateVoiceDisp();
        } catch (e) {
            console.error('Failed to load voice config:', e);
        }
    }

    async function saveVoiceConfig() {
        var voiceEnabled = voiceToggleEnabled.classList.contains('on');

        try {
            var resp = await fetch(API_BASE + '/api/voice/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: voiceEnabled,
                    autoSend: autoSend,
                    silenceTimeout: silenceTimeout
                })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || 'HTTP ' + resp.status);
            }

            // Apply to runtime
            if (voiceEnabled && !isActive) {
                window.live2dVoice.start().catch(function(e) {
                    console.error('Failed to start voice:', e);
                    alert('麦克风启动失败: ' + e.message);
                    voiceToggleEnabled.className = 'toggle';
                });
            } else if (!voiceEnabled && isActive) {
                window.live2dVoice.stop();
            }
        } catch (e) {
            console.error('Failed to save voice config:', e);
            alert('保存失败: ' + e.message);
            return;
        }

        hideVoiceSettings();
    }

    function updateVoiceDisp() {
        var secs = parseInt(voiceRangeSilence.value) / 10;
        voiceDispSilence.textContent = secs.toFixed(1);
        voiceValSilence.textContent = secs.toFixed(1);
        silenceTimeout = secs;
    }

    voiceToggleEnabled.addEventListener('click', function() {
        this.classList.toggle('on');
    });

    voiceToggleAutosend.addEventListener('click', function() {
        this.classList.toggle('on');
        autoSend = this.classList.contains('on');
    });

    voiceRangeSilence.addEventListener('input', updateVoiceDisp);

    document.getElementById('btn-voice-settings-save').addEventListener('click', saveVoiceConfig);
    document.getElementById('btn-voice-settings-close').addEventListener('click', hideVoiceSettings);

    voiceOverlay.addEventListener('click', function(e) {
        if (e.target === voiceOverlay) hideVoiceSettings();
    });

    window.live2dVoiceSettings = {
        show: showVoiceSettings,
        hide: hideVoiceSettings
    };

    // ── Auto-start on page load if voice is enabled ──
    (async function autoInit() {
        try {
            var resp = await fetch(API_BASE + '/api/voice/config');
            if (!resp.ok) return;
            var cfg = await resp.json();

            if (typeof cfg.autoSend === 'boolean') autoSend = cfg.autoSend;
            if (typeof cfg.silenceTimeout === 'number') silenceTimeout = cfg.silenceTimeout;

            if (cfg.enabled === true) {
                console.log('Voice auto-start: config has enabled=true, starting microphone...');
                await window.live2dVoice.start();
                console.log('Voice auto-start: microphone active');
            } else {
                console.log('Voice auto-start: disabled in config, skipping');
            }
        } catch (e) {
            // Expected on first run or if mic permission denied
            console.log('Voice auto-start: not available (' + (e.message || e) + ')');
        }
    })();

    console.log('live2d-voice module initialized');
})();
