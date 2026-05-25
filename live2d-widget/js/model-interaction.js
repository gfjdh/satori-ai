// model-interaction.js - 模型交互控制器
// 处理拖动、缩放、点击等交互
// 模型缩放和窗口缩放彻底分离：鼠标在模型上→缩模，空白处→缩窗

class ModelInteractionController {
    constructor() {
        this.model = null;
        this.app = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };

        this._nativeWidth = 0;
        this._nativeHeight = 0;
        this._fitScale = 1.0;
        this._modelZoom = 1.0;
        this._scaleMultiplier = 2.3;
        this._offsetX = 0;
        this._offsetY = 0;
    }

    init(model, app) {
        this.model = model;
        this.app = app;
        this._nativeWidth = model.width;
        this._nativeHeight = model.height;
        this.setupInteractivity();
    }

    _recalcFitScale() {
        const sx = (window.innerWidth * this._scaleMultiplier) / this._nativeWidth;
        const sy = (window.innerHeight * this._scaleMultiplier) / this._nativeHeight;
        this._fitScale = Math.min(sx, sy);
    }

    _applyModelScale() {
        this.model.scale.set(this._fitScale * this._modelZoom);
    }

    _centerModel() {
        this.model.x = window.innerWidth / 2 - this.model.width / 2 + this._offsetX;
        this.model.y = window.innerHeight * 0.6 + this._offsetY;
    }

    updateInteractionArea() {
        if (!this.model) return;
        this.interactionWidth = this.model.width / 3;
        this.interactionHeight = this.model.height * 0.7;
        this.interactionX = this.model.x + (this.model.width - this.interactionWidth) / 2;
        this.interactionY = this.model.y + (this.model.height - this.interactionHeight) / 2;
    }

    setupInteractivity() {
        if (!this.model) return;

        this.model.interactive = true;

        this.model.containsPoint = (point) => {
            if (!this.model) return false;
            const bounds = this.getInteractionBounds();
            return point.x >= bounds.x &&
                point.x <= bounds.x + bounds.width &&
                point.y >= bounds.y &&
                point.y <= bounds.y + bounds.height;
        };

        this.model.on('mousedown', (e) => {
            if (this.model.containsPoint(e.data.global)) {
                this.isDragging = true;
                this.dragOffset.x = e.data.global.x - this.model.x;
                this.dragOffset.y = e.data.global.y - this.model.y;
            }
        });

        this.model.on('mousemove', (e) => {
            if (this.isDragging) {
                this.model.x = e.data.global.x - this.dragOffset.x;
                this.model.y = e.data.global.y - this.dragOffset.y;
                this.updateInteractionArea();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                saveModelPosition(this.model);
            }
        });

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

        // 统一 wheel 处理：模型上→缩模，空白处→缩窗
        window.addEventListener('wheel', (e) => {
            if (!this.model) return;

            const mousePos = this.app.renderer.plugins.interaction.mouse.global;
            const onModel = this.model.containsPoint(mousePos);

            if (onModel) {
                this._handleModelZoom(e);
            } else {
                this._handleWindowZoom(e);
            }
        }, { passive: false });

        // 窗口大小改变 → 重算 fitScale，模型和对话框跟随
        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                this.app.renderer.resize(window.innerWidth * 2, window.innerHeight * 2);
                this.app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
                this.app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

                const oldWidth = this.model.width;
                const oldHeight = this.model.height;
                this._recalcFitScale();
                this._applyModelScale();
                this.model.x += (this.model.width - oldWidth) / 2;
                this.model.y += (this.model.height - oldHeight) / 2;

                this.updateInteractionArea();
                updateDialogScale();
                saveModelPosition(this.model);
            }
        });

        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        this.updateInteractionArea();
    }

    _handleModelZoom(e) {
        e.preventDefault();
        const zoomStep = 0.1;
        const oldZoom = this._modelZoom;
        const newZoom = e.deltaY > 0
            ? Math.max(0.3, oldZoom - zoomStep)
            : Math.min(3.0, oldZoom + zoomStep);

        if (newZoom !== oldZoom) {
            this._modelZoom = newZoom;

            const oldWidth = this.model.width;
            const oldHeight = this.model.height;
            this._applyModelScale();
            this.model.x -= (this.model.width - oldWidth) / 2;
            this.model.y -= (this.model.height - oldHeight) / 2;
            this.updateInteractionArea();
        }
    }

    _handleWindowZoom(e) {
        e.preventDefault();
        const zoomStep = 0.1;
        // 使用独立计数器确保因子精确互为倒数
        if (!this._windowZoomCounter) this._windowZoomCounter = 1.0;
        const oldZoom = this._windowZoomCounter;
        const newZoom = e.deltaY > 0
            ? Math.max(0.3, oldZoom - zoomStep)
            : Math.min(3.0, oldZoom + zoomStep);

        if (newZoom !== oldZoom) {
            const factor = newZoom / oldZoom;
            this._windowZoomCounter = newZoom;
            console.log('L2D_SCALE:' + factor);
        }
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

    setupInitialModelProperties(scaleMultiplier = 2.3, offsetX = 0, offsetY = 0) {
        if (!this.model || !this.app) return;

        this._scaleMultiplier = scaleMultiplier;
        this._offsetX = offsetX;
        this._offsetY = offsetY;

        this._recalcFitScale();
        this._modelZoom = 1.0;
        this._windowZoomCounter = 1.0;
        this._applyModelScale();
        this._centerModel();
        this.updateInteractionArea();
    }
}
