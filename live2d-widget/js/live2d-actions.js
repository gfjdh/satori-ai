// live2d-actions.js - 动作执行模块
(function() {
    'use strict';

    var API_BASE = '';
    var actionMap = {};
    var loaded = false;
    var model = null;

    var $overlay = document.getElementById('error-overlay');
    var $errMsg = document.getElementById('error-message');

    function showError(msg) {
        console.error(msg);
        if ($errMsg) { $errMsg.textContent = msg; }
        if ($overlay) { $overlay.style.display = 'block'; }
    }

    function hideError() {
        if ($overlay) { $overlay.style.display = 'none'; }
    }

    async function loadActions(retries) {
        if (retries === undefined) retries = 0;
        try {
            var resp = await fetch(API_BASE + '/api/character/live2d-config');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var cfg = await resp.json();
            if (cfg.actions && Object.keys(cfg.actions).length > 0) {
                actionMap = cfg.actions;
                loaded = true;
                hideError();
                console.log('Actions loaded:', Object.keys(actionMap).join(', '));
            } else {
                showError('角色卡未配置 live2d.actions');
            }
        } catch (e) {
            if (retries < 10) {
                console.warn('Actions load retry ' + (retries + 1) + '/10:', e.message);
                setTimeout(function() { loadActions(retries + 1); }, 2000);
            } else {
                showError('动作加载失败: ' + e.message);
            }
        }
    }

    async function execute(actionName) {
        if (!actionName) return;
        if (!loaded) { showError('动作尚未加载完成，请稍候再试'); return; }
        var mapping = actionMap[actionName];
        if (!mapping) {
            showError('未找到动作: ' + actionName + '\n可用: ' + Object.keys(actionMap).join(', '));
            return;
        }
        if (!model || !model.internalModel) { showError('Live2D 模型尚未就绪'); return; }

        var group = mapping.group;
        var index = mapping.index;

        try {
            await model.motion(group, index);
            hideError();
        } catch (e) {
            showError('动作执行异常: ' + actionName + '\ngroup=' + JSON.stringify(group) + ' index=' + index + '\n' + e.message);
        }
    }

    function bindModel() {
        if (window.live2dModel) {
            model = window.live2dModel;
            hideError();
            console.log('live2d-actions: model bound');
        } else {
            setTimeout(bindModel, 500);
        }
    }

    loadActions().then(function() {
        bindModel();
    });

    window.live2dActions = {
        execute: execute,
        reload: loadActions
    };

    console.log('live2d-actions module initialized');
})();
