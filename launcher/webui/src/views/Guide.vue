<template>
  <div class="guide">
    <h2>安装指南</h2>
    <div class="card">
      <h3>快速开始</h3>
      <ol>
        <li>在「初始化」页面完成 4 步向导</li>
        <li>在「初始化」页面获取下载链接，手动下载后在「环境」页面安装</li>
        <li>自动创建 Python 虚拟环境并安装依赖</li>
        <li>配置 LLM API Key 后即可启动全部服务</li>
      </ol>
    </div>
    <div class="card">
      <h3>常见问题</h3>
      <div class="faq">
        <h4>下载速度慢？</h4>
        <p>启动器使用国内镜像源（清华 PyPI、npmmirror），通常速度很快。如仍较慢，请检查网络代理设置。</p>
        <h4>Python 安装失败？</h4>
        <p>内置的嵌入式 Python 无需系统安装。如使用系统 Python，请确保版本为 3.12 或 3.13。</p>
        <h4>服务启动失败？</h4>
        <p>请检查「环境」页面确认所有运行时已安装，然后在「初始化」页面重新执行环境初始化。</p>
        <h4>如何更新？</h4>
        <p>在「更新」页面连接 Gitee 仓库后，可一键检查并应用更新。</p>
      </div>
    </div>
    <div class="card">
      <h3>手动安装指南</h3>
      <div class="manual">
        <h4>Node.js</h4>
        <p>访问 <a href="https://nodejs.org/zh-cn/download/" target="_blank">nodejs.org</a> 下载 v24 LTS 安装包。</p>
        <h4>Python</h4>
        <p>访问 <a href="https://www.python.org/downloads/" target="_blank">python.org</a> 下载 3.12 或 3.13 版本。安装时勾选「Add Python to PATH」。</p>
        <h4>Git</h4>
        <p>访问 <a href="https://git-scm.com/download/win" target="_blank">git-scm.com</a> 下载 Git for Windows。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
</script>

<style scoped>
.guide { max-width: 700px; display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
.card h3 { margin: 0 0 12px; }
.card h4 { margin: 12px 0 4px; }
.card p { color: #6b7280; font-size: 14px; margin: 0 0 8px; }
ol { padding-left: 20px; }
ol li { margin-bottom: 6px; color: #374151; }
.faq, .manual { font-size: 14px; }
a { color: #6366f1; }
</style>
