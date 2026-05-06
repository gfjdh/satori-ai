// model-interaction.js - 模型交互控制器
// 处理拖动、缩放、点击等交互

class ModelInteractionController {
    constructor() {
        this.model = null;
        this.app = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
    }

    init(model, app) {
        this.model = model;
        this.app = app;
        this.setupInteractivity();
    }

    updateInteractionArea() {
        if (!this.model) return;
        // 交互区域为模型中央偏下区域
        this.interactionWidth = this.model.width / 3;
        this.interactionHeight = this.model.height * 0.7;
        this.interactionX = this.model.x + (this.model.width - this.interactionWidth) / 2;
        this.interactionY = this.model.y + (this.model.height - this.interactionHeight) / 2;
    }

    setupInteractivity() {
        if (!this.model) return;

        this.model.interactive = true;

        // 自定义碰撞检测
        this.model.containsPoint = (point) => {
            if (!this.model) return false;
            const bounds = this.getInteractionBounds();
            return point.x >= bounds.x &&
                point.x <= bounds.x + bounds.width &&
                point.y >= bounds.y &&
                point.y <= bounds.y + bounds.height;
        };

        // 鼠标按下 - 开始拖动
        this.model.on('mousedown', (e) => {
            if (this.model.containsPoint(e.data.global)) {
                this.isDragging = true;
                this.dragOffset.x = e.data.global.x - this.model.x;
                this.dragOffset.y = e.data.global.y - this.model.y;
            }
        });

        // 鼠标移动 - 拖动模型
        this.model.on('mousemove', (e) => {
            if (this.isDragging) {
                this.model.x = e.data.global.x - this.dragOffset.x;
                this.model.y = e.data.global.y - this.dragOffset.y;
                this.updateInteractionArea();
            }
        });

        // 鼠标释放 - 停止拖动并保存位置
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                saveModelPosition(this.model);
            }
        });

        // 点击事件 - 触发动作
        this.model.on('click', () => {
            if (this.model && this.model.internalModel) {
                try {
                    this.model.motion("Tap");
                    this.model.expression();
                } catch (e) {
                    console.log('触发动作失败:', e.message);
                }
            }
        });

        // 滚轮缩放
        window.addEventListener('wheel', (e) => {
            if (!this.model) return;
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                e.preventDefault();
                const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
                const currentScale = this.model.scale.x;
                const newScale = currentScale * scaleChange;

                // 限制缩放范围
                const minScale = currentScale * 0.3;
                const maxScale = currentScale * 3.0;
                if (newScale >= minScale && newScale <= maxScale) {
                    this.model.scale.set(newScale);
                    // 保持中心点不变
                    const deltaWidth = this.model.width - (this.model.width / scaleChange);
                    const deltaHeight = this.model.height - (this.model.height / scaleChange);
                    this.model.x -= deltaWidth / 2;
                    this.model.y -= deltaHeight / 2;
                    this.updateInteractionArea();
                }
            }
        }, { passive: false });

        // 窗口大小改变
        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                this.app.renderer.resize(window.innerWidth * 2, window.innerHeight * 2);
                this.app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
                this.app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);
                this.updateInteractionArea();
            }
        });

        // 禁用右键菜单
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        this.updateInteractionArea();
    }

    getInteractionBounds() {
        if (this.interactionX !== undefined) {
            return {
                x: this.interactionX,
                y: this.interactionY,
                width: this.interactionWidth,
                height: this.interactionHeight
            };
        }
        return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    }

    setupInitialModelProperties(scaleMultiplier = 2.3) {
        if (!this.model || !this.app) return;

        // 根据窗口大小计算初始缩放
        const scaleX = (window.innerWidth * scaleMultiplier) / this.model.width;
        const scaleY = (window.innerHeight * scaleMultiplier) / this.model.height;
        this.model.scale.set(Math.min(scaleX, scaleY));

        // 默认位置 - 窗口中央偏下
        this.model.x = window.innerWidth / 2 - this.model.width / 2;
        this.model.y = window.innerHeight * 0.6;

        this.updateInteractionArea();
    }
}