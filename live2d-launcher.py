#!/usr/bin/env python3
"""
Satori Live2D 桌宠启动器
使用 PySide6 创建无边框、悬浮置顶窗口，加载 live2d-widget 页面
"""

import sys
import os
from PySide6.QtWidgets import QApplication, QMainWindow, QLabel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtCore import QUrl, Qt, QTimer
from PySide6.QtGui import QColor, QPainter, QRegion


class Live2DViewer(QWebEngineView):
    """自定义 WebEngineView，支持透明背景"""

    def __init__(self, parent=None):
        super().__init__(parent)
        # 设置透明背景
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.page().setBackgroundColor(QColor(0, 0, 0, 0))


class Live2DWindow(QMainWindow):
    """无边框悬浮置顶窗口"""

    def __init__(self, url):
        super().__init__()

        # 获取主屏幕尺寸
        screen = QApplication.primaryScreen()
        screen_geometry = screen.geometry()
        screen_width = screen_geometry.width()
        screen_height = screen_geometry.height()

        # 窗口配置
        window_width = 400
        window_height = 600

        # 位置：右下角
        x = screen_width - window_width - 20
        y = screen_height - window_height - 20

        self.setGeometry(x, y, window_width, window_height)
        self.setFixedSize(window_width, window_height)

        # 无边框、置顶、背景透明
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.SubWindow
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

        # 创建 WebView
        self.web_view = Live2DViewer(self)
        self.setCentralWidget(self.web_view)

        # 配置 WebEngine
        settings = self.web_view.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.ShowScrollBars, False)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

        # 加载页面
        self.web_view.load(QUrl(url))

        print(f'桌宠加载中: {url}')
        self.web_view.loadFinished.connect(self.on_load_finished)

    def on_load_finished(self, ok):
        if ok:
            print('页面加载完成')
        else:
            print('页面加载失败', file=sys.stderr)

    def mousePressEvent(self, event):
        """支持拖动窗口"""
        self._start_pos = event.globalPosition().toPoint()

    def mouseMoveEvent(self, event):
        """拖动时移动窗口"""
        if hasattr(self, '_start_pos'):
            delta = event.globalPosition().toPoint() - self._start_pos
            self.move(self.pos() + delta)
            self._start_pos = event.globalPosition().toPoint()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName('Satori Live2D')

    # 后端 URL
    LIVE2D_URL = os.environ.get('LIVE2D_URL', 'http://localhost:3000/live2d')

    window = Live2DWindow(LIVE2D_URL)
    window.show()

    print(f'桌宠已启动，运行在 {LIVE2D_URL}')
    print('窗口：400x600，悬浮右下角，无边框')

    sys.exit(app.exec())


if __name__ == '__main__':
    main()