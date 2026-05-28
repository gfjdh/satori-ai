// model-setup.js - 模型加载和PIXI初始化
// 从后端API动态获取当前角色卡的Live2D配置

const API_BASE = '';

// 获取当前角色卡的Live2D配置
async function fetchLive2DConfig() {
    try {
        const response = await fetch(`${API_BASE}/api/character/live2d-config`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const config = await response.json();
        return config;
    } catch (error) {
        throw new Error(`获取Live2D配置失败: ${error.message}。请检查后端服务是否启动。`);
    }
}

// 初始化PIXI应用和Live2D模型
async function initializeModel() {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error-overlay');
    const errorMsgEl = document.getElementById('error-message');

    loadingEl.style.display = 'block';

    try {
        // 1. 获取角色卡Live2D配置
        const live2dConfig = await fetchLive2DConfig();

        if (!live2dConfig.modelPath) {
            throw new Error('角色卡中未配置Live2D模型路径。请在角色卡设置中配置模型文件。');
        }

        console.log('加载Live2D模型:', live2dConfig);

        // 2. 创建PIXI应用
        const app = new PIXI.Application({
            view: document.getElementById("canvas"),
            autoStart: true,
            transparent: true,
            width: window.innerWidth * 2,
            height: window.innerHeight * 2
        });

        app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
        app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

        // 3. 加载Live2D模型（使用完整URL）
        const modelUrl = live2dConfig.modelUrl || live2dConfig.modelPath;
        console.log('模型URL:', modelUrl);
        const model = await PIXI.live2d.Live2DModel.from(modelUrl, { motionPreload: "ALL" });
        app.stage.addChild(model);

        // 4. 初始化交互控制器
        const controller = new ModelInteractionController();
        controller.init(model, app);
        controller.setupInitialModelProperties(
            live2dConfig.scale || 2.3,
            live2dConfig.modelOffsetX || 0,
            live2dConfig.modelOffsetY || 0
        );

        // 5. 保存配置供其他地方使用
        window.live2dController = controller;
        window.live2dModel = model;

        // 6. 恢复保存的位置和缩放
        restoreModelState(model, controller);

        // 7. 初始化对话框缩放
        updateDialogScale();

        // 8. 退出前保存最新状态
        window.addEventListener('beforeunload', function() {
            saveModelPosition(model);
        });

        loadingEl.style.display = 'none';
        console.log('Live2D模型加载完成');

        return { app, model, controller };

    } catch (error) {
        loadingEl.style.display = 'none';
        errorMsgEl.textContent = error.message;
        errorEl.style.display = 'block';
        console.error('模型加载失败:', error);
        throw error;
    }
}

// 按比例保存模型位置和缩放
function saveModelPosition(model) {
    var ctrl = window.live2dController;
    var pos = {
        x: model.x / window.innerWidth,
        y: model.y / window.innerHeight,
        mz: ctrl ? ctrl._modelZoom : 1.0
    };
    localStorage.setItem('live2d_model_position', JSON.stringify(pos));
}

// 按比例恢复模型位置和缩放
function restoreModelState(model, controller) {
    var saved = localStorage.getItem('live2d_model_position');
    if (saved) {
        try {
            var pos = JSON.parse(saved);
            if (pos.x !== null && pos.y !== null) {
                model.x = pos.x * window.innerWidth;
                model.y = pos.y * window.innerHeight;

                if (pos.mz !== undefined) {
                    controller._modelZoom = pos.mz;
                    controller._applyModelScale();
                }
                controller.updateInteractionArea();
            }
        } catch (e) {
            console.warn('恢复位置失败:', e);
        }
    }
}

// 根据窗口大小更新对话框和字幕的缩放比例
function updateDialogScale() {
    var baseWidth = 400;
    var scale = window.innerWidth / baseWidth;
    document.documentElement.style.setProperty('--window-scale', scale);
}

// 启动
initializeModel().catch(console.error);
