// live2d-settings.js - 互动频率设置面板
(function() {
    'use strict';

    var API_BASE = '';

    var overlay = document.getElementById('settings-overlay');
    var toggle = document.getElementById('toggle-enabled');
    var toggleStartupGreeting = document.getElementById('toggle-startup-greeting');
    var rangeMin = document.getElementById('range-min');
    var rangeMax = document.getElementById('range-max');
    var dispMin = document.getElementById('disp-min');
    var dispMax = document.getElementById('disp-max');
    var valMin = document.getElementById('val-min');
    var valMax = document.getElementById('val-max');

    var enabled = true;
    var startupGreeting = true;

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
            var resp = await fetch(API_BASE + '/api/proactive/config');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var cfg = await resp.json();
            enabled = cfg.enabled !== false;
            startupGreeting = cfg.startupGreeting !== false;
            toggle.className = 'toggle' + (enabled ? ' on' : '');
            toggleStartupGreeting.className = 'toggle' + (startupGreeting ? ' on' : '');
            rangeMin.value = cfg.minIntervalMinutes || 8;
            rangeMax.value = cfg.maxIntervalMinutes || 20;
            updateDisp();
        } catch (e) {
            console.error('Failed to load proactive config:', e);
        }
    }

    async function saveConfig() {
        var minVal = parseInt(rangeMin.value);
        var maxVal = parseInt(rangeMax.value);

        if (minVal > maxVal) {
            alert('最小间隔不能大于最大间隔');
            return;
        }

        try {
            var resp = await fetch(API_BASE + '/api/proactive/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: enabled,
                    minIntervalMinutes: minVal,
                    maxIntervalMinutes: maxVal,
                    startupGreeting: startupGreeting
                })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || 'HTTP ' + resp.status);
            }
        } catch (e) {
            console.error('Failed to save proactive config:', e);
            alert('保存失败: ' + e.message);
            return;
        }

        hide();
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

    toggleStartupGreeting.addEventListener('click', function() {
        startupGreeting = !startupGreeting;
        toggleStartupGreeting.className = 'toggle' + (startupGreeting ? ' on' : '');
    });

    rangeMin.addEventListener('input', updateDisp);
    rangeMax.addEventListener('input', updateDisp);

    document.getElementById('btn-settings-save').addEventListener('click', saveConfig);
    document.getElementById('btn-settings-close').addEventListener('click', hide);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) hide();
    });

    window.live2dSettings = {
        show: show,
        hide: hide
    };

    console.log('live2d-settings module initialized');
})();
