// live2d-settings.js - 互动频率设置面板
(function() {
    'use strict';

    const API_BASE = '';

    const overlay = document.getElementById('settings-overlay');
    const toggle = document.getElementById('toggle-enabled');
    const rangeMin = document.getElementById('range-min');
    const rangeMax = document.getElementById('range-max');
    const dispMin = document.getElementById('disp-min');
    const dispMax = document.getElementById('disp-max');
    const valMin = document.getElementById('val-min');
    const valMax = document.getElementById('val-max');

    let enabled = true;

    function show() {
        loadConfig().then(function() {
            overlay.classList.add('visible');
        });
    }

    function hide() {
        overlay.classList.remove('visible');
    }

    async function loadConfig() {
        try {
            const resp = await fetch(API_BASE + '/api/proactive/config');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const cfg = await resp.json();
            enabled = cfg.enabled !== false;
            toggle.className = 'toggle' + (enabled ? ' on' : '');
            rangeMin.value = cfg.minIntervalMinutes || 8;
            rangeMax.value = cfg.maxIntervalMinutes || 20;
            updateDisp();
        } catch (e) {
            console.error('Failed to load proactive config:', e);
        }
    }

    async function saveConfig() {
        const minVal = parseInt(rangeMin.value);
        const maxVal = parseInt(rangeMax.value);

        if (minVal > maxVal) {
            alert('最小间隔不能大于最大间隔');
            return;
        }

        try {
            const resp = await fetch(API_BASE + '/api/proactive/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: enabled,
                    minIntervalMinutes: minVal,
                    maxIntervalMinutes: maxVal
                })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.error || 'HTTP ' + resp.status);
            }
            hide();
        } catch (e) {
            console.error('Failed to save proactive config:', e);
            alert('保存失败: ' + e.message);
        }
    }

    function updateDisp() {
        var minV = rangeMin.value;
        var maxV = rangeMax.value;
        dispMin.textContent = minV;
        dispMax.textContent = maxV;
        valMin.textContent = minV;
        valMax.textContent = maxV;

        if (parseInt(minV) > parseInt(maxV)) {
            rangeMax.value = minV;
            dispMax.textContent = minV;
            valMax.textContent = minV;
        }
    }

    toggle.addEventListener('click', function() {
        enabled = !enabled;
        toggle.className = 'toggle' + (enabled ? ' on' : '');
    });

    rangeMin.addEventListener('input', updateDisp);
    rangeMax.addEventListener('input', updateDisp);

    document.getElementById('btn-settings-save').addEventListener('click', saveConfig);
    document.getElementById('btn-settings-close').addEventListener('click', hide);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) hide();
    });

    // 注册到全局，供 Python launcher 调用
    window.live2dSettings = {
        show: show,
        hide: hide
    };

    console.log('live2d-settings module initialized');
})();
