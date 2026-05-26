#!/usr/bin/env python3
"""
Satori Live2D 桌宠启动器
使用 PySide6 创建无边框、悬浮置顶窗口，加载 live2d-widget 页面
"""

import sys
import os
import json
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QMenu
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEnginePage
from PySide6.QtCore import QUrl, Qt, QEvent, QPoint, QTimer
from PySide6.QtGui import QColor, QPainter, QPainterPath, QCursor


POSITION_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'window_position.json')

BASE_WIDTH = 400
BASE_HEIGHT = 600


def load_position():
    try:
        with open(POSITION_FILE, 'r') as f:
            data = json.load(f)
            return data.get('x'), data.get('y'), data.get('w', BASE_WIDTH), data.get('h', BASE_HEIGHT)
    except (FileNotFoundError, json.JSONDecodeError):
        return None, None, BASE_WIDTH, BASE_HEIGHT


def save_position(x, y, w, h):
    os.makedirs(os.path.dirname(POSITION_FILE), exist_ok=True)
    with open(POSITION_FILE, 'w') as f:
        json.dump({'x': x, 'y': y, 'w': w, 'h': h}, f)


class Live2DWebPage(QWebEnginePage):
    """拦截 JS console.log 消息，实现模型缩放→窗口缩放联动"""

    def __init__(self, window, parent=None):
        super().__init__(parent)
        self._window = window

    def javaScriptConsoleMessage(self, level, message, lineNumber, sourceID):
        if message.startswith('L2D_SCALE:'):
            try:
                factor = float(message.split(':')[1])
                self._window.resize_by_factor(factor)
            except ValueError:
                pass


class DragHandle(QWidget):
    """拖动把手 — 窗口顶部可见的拖拽区域"""

    def __init__(self, parent_window):
        super().__init__(parent_window)
        self._window = parent_window
        self.setFixedHeight(28)
        self.setCursor(QCursor(Qt.CursorShape.OpenHandCursor))
        self._dragging = False
        self._drag_start_pos = None

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = self.width()
        h = self.height()

        path = QPainterPath()
        path.addRoundedRect(4, 4, w - 8, h - 8, 8, 8)
        painter.fillPath(path, QColor(0, 0, 0, 80))

        painter.setBrush(QColor(255, 255, 255, 180))
        painter.setPen(Qt.PenStyle.NoPen)

        cy = h // 2
        dot_spacing = 10
        dot_radius = 2.5
        num_dots = 3
        start_x = (w - (num_dots - 1) * dot_spacing) // 2

        for i in range(num_dots):
            x = start_x + i * dot_spacing
            painter.drawEllipse(QPoint(x, cy), dot_radius, dot_radius)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._window._cancel_dodge()
            self._dragging = True
            self._drag_start_pos = event.globalPosition().toPoint()
            self.setCursor(QCursor(Qt.CursorShape.ClosedHandCursor))

    def mouseMoveEvent(self, event):
        if self._dragging:
            delta = event.globalPosition().toPoint() - self._drag_start_pos
            self._window.move(self._window.pos() + QPoint(delta.x(), delta.y()))
            self._drag_start_pos = event.globalPosition().toPoint()

    def mouseReleaseEvent(self, event):
        if self._dragging:
            self._dragging = False
            self.setCursor(QCursor(Qt.CursorShape.OpenHandCursor))
            pos = self._window.pos()
            sz = self._window.size()
            save_position(pos.x(), pos.y(), sz.width(), sz.height())

    def enterEvent(self, event):
        self.update()
        self._window._schedule_dodge()

    def leaveEvent(self, event):
        self.update()


class Live2DViewer(QWebEngineView):
    """自定义 WebEngineView，支持透明背景和 console 拦截"""

    def __init__(self, window, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        page = Live2DWebPage(window, self)
        page.setBackgroundColor(QColor(0, 0, 0, 0))
        self.setPage(page)


class Live2DWindow(QMainWindow):
    """无边框悬浮置顶窗口"""

    def __init__(self, url):
        super().__init__()

        screen = QApplication.primaryScreen()
        screen_geometry = screen.geometry()
        screen_width = screen_geometry.width()
        screen_height = screen_geometry.height()

        saved_x, saved_y, saved_w, saved_h = load_position()

        if saved_x is not None and saved_y is not None:
            x = saved_x
            y = saved_y
        else:
            x = screen_width - BASE_WIDTH - 20
            y = screen_height - BASE_HEIGHT - 20

        self._base_width = BASE_WIDTH
        self._base_height = BASE_HEIGHT

        self.setGeometry(x, y, saved_w, saved_h)
        self.setMinimumSize(200, 300)
        self.setMaximumSize(screen_width, screen_height)

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        central = QWidget(self)
        central.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.drag_handle = DragHandle(self)
        layout.addWidget(self.drag_handle)

        self.web_view = Live2DViewer(self, central)
        layout.addWidget(self.web_view)

        self.setCentralWidget(central)

        # --- Dodge state ---
        self._original_pos = None
        self._dodge_cooldown = False
        self._dodge_phase = 'idle'
        self._dodge_pending = QTimer()
        self._dodge_pending.setSingleShot(True)
        self._dodge_pending.timeout.connect(self._start_dodge)
        self._dodge_anim = QTimer()
        self._dodge_anim.timeout.connect(self._dodge_anim_step)
        self._dodge_return = QTimer()
        self._dodge_return.setSingleShot(True)
        self._dodge_return.timeout.connect(self._return_from_dodge)

        self._mouse_inside = False
        self._mouse_poll = QTimer()
        self._mouse_poll.timeout.connect(self._poll_mouse)
        self._mouse_poll.start(100)

        self.web_view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self.web_view.installEventFilter(self)

        settings = self.web_view.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.ShowScrollBars, False)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

        self.web_view.load(QUrl(url))

        print(f'桌宠加载中: {url}')
        self.web_view.loadFinished.connect(self.on_load_finished)

    # ---- Dodge ----

    def _schedule_dodge(self):
        if self._dodge_cooldown or self._dodge_pending.isActive():
            return
        self._dodge_pending.start(300)

    def _cancel_dodge(self):
        self._dodge_pending.stop()
        self._dodge_return.stop()
        self._dodge_anim.stop()
        self._dodge_phase = 'idle'
        self._dodge_cooldown = False
        self._original_pos = None

    def _poll_mouse(self):
        global_pos = QCursor.pos()
        inside = self.geometry().contains(global_pos)
        if inside and not self._mouse_inside:
            self._mouse_inside = True
            self._schedule_dodge()
        elif not inside:
            self._mouse_inside = False

    def _start_dodge(self):
        if self._dodge_cooldown:
            return

        self._original_pos = self.pos()
        screen = QApplication.primaryScreen().geometry()
        screen_center = screen.center()
        window_center = self.geometry().center()

        dx = screen_center.x() - window_center.x()
        dy = screen_center.y() - window_center.y()

        dist = (dx * dx + dy * dy) ** 0.5
        if dist < 5:
            return

        dodge_dist = min(500, dist * 1.25)
        self._dodge_target = QPoint(
            self._original_pos.x() + int(dx / dist * dodge_dist),
            self._original_pos.y() + int(dy / dist * dodge_dist),
        )

        # Clamp to screen
        self._dodge_target.setX(max(0, min(screen.width() - self.width(), self._dodge_target.x())))
        self._dodge_target.setY(max(0, min(screen.height() - self.height(), self._dodge_target.y())))

        self._dodge_start = QPoint(self._original_pos)
        self._dodge_step_i = 0
        self._dodge_cooldown = True
        self._dodge_phase = 'dodging'
        self._dodge_anim.start(16)

    def _dodge_anim_step(self):
        self._dodge_step_i += 1

        if self._dodge_phase == 'dodging':
            total = 8
            if self._dodge_step_i >= total:
                self._dodge_anim.stop()
                self.move(self._dodge_target)
                self._dodge_phase = 'cooldown'
                self._dodge_return.start(5000)
                return
            t = self._dodge_step_i / total
            eased = 1.0 - (1.0 - t) ** 3
            x = self._dodge_start.x() + (self._dodge_target.x() - self._dodge_start.x()) * eased
            y = self._dodge_start.y() + (self._dodge_target.y() - self._dodge_start.y()) * eased
            self.move(int(x), int(y))

        elif self._dodge_phase == 'returning':
            total = 20
            if self._dodge_step_i >= total:
                self._dodge_anim.stop()
                self.move(self._return_target)
                self._original_pos = None
                self._dodge_phase = 'idle'
                self._dodge_cooldown = False
                return
            t = self._dodge_step_i / total
            eased = 1.0 - (1.0 - t) ** 3
            x = self._return_start.x() + (self._return_target.x() - self._return_start.x()) * eased
            y = self._return_start.y() + (self._return_target.y() - self._return_start.y()) * eased
            self.move(int(x), int(y))

    def _return_from_dodge(self):
        if self._original_pos is None:
            self._dodge_phase = 'idle'
            self._dodge_cooldown = False
            return
        self._return_start = QPoint(self.pos())
        self._return_target = QPoint(self._original_pos)
        self._dodge_step_i = 0
        self._dodge_phase = 'returning'
        self._dodge_anim.start(16)

    def resize_by_factor(self, factor):
        current = self.size()
        new_w = int(current.width() * factor)
        new_h = int(current.height() * factor)

        min_w, max_w = 200, self.maximumWidth()
        min_h, max_h = 300, self.maximumHeight()

        if min_w <= new_w <= max_w and min_h <= new_h <= max_h:
            self.resize(new_w, new_h)
            pos = self.pos()
            save_position(pos.x(), pos.y(), new_w, new_h)

    def eventFilter(self, obj, event):
        if event.type() == QEvent.Type.ContextMenu and obj is self.web_view:
            self.show_context_menu(event.globalPos())
            return True
        return super().eventFilter(obj, event)

    def show_context_menu(self, global_pos):
        menu = QMenu(self)

        menu.addAction('打开管理页面', self.open_admin_page)
        menu.addAction('互动', self.handle_interaction)
        menu.addAction('变装', self.handle_change_costume)
        menu.addAction('隐藏', self.hide_window)
        menu.addAction('设置互动频率', self.open_settings)
        menu.addAction('退出', self.close_app)

        menu.exec(global_pos)

    def on_load_finished(self, ok):
        if ok:
            print('页面加载完成')
        else:
            print('页面加载失败', file=sys.stderr)

    def open_admin_page(self):
        import webbrowser
        webbrowser.open('http://localhost:5173')

    def handle_interaction(self):
        print('互动功能待实现')

    def handle_change_costume(self):
        print('变装功能待实现')

    def hide_window(self):
        self.hide()

    def open_settings(self):
        print('设置互动频率待实现')

    def close_app(self):
        pos = self.pos()
        sz = self.size()
        save_position(pos.x(), pos.y(), sz.width(), sz.height())
        QApplication.quit()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName('Satori Live2D')

    LIVE2D_URL = os.environ.get('LIVE2D_URL', 'http://localhost:3000/live2d')

    window = Live2DWindow(LIVE2D_URL)
    window.show()

    print(f'桌宠已启动，运行在 {LIVE2D_URL}')
    print('窗口：400x600，悬浮右下角，无边框')

    sys.exit(app.exec())


if __name__ == '__main__':
    main()
