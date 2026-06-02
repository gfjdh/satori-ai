package api

import (
	"encoding/json"
	"net/http"

	"satori-launcher/svc"
)

func (s *Server) handleEnv(w http.ResponseWriter, r *http.Request) {
	result := svc.DetectAll()
	writeJSON(w, result)
}

type installGuide struct {
	Tool        string   `json:"tool"`
	DisplayName string   `json:"displayName"`
	URL         string   `json:"url"`
	Note        string   `json:"note"`
	Steps       []string `json:"steps"`
}

func (s *Server) handleInstallGuide(w http.ResponseWriter, r *http.Request) {
	tool := r.PathValue("tool")
	guides := map[string]installGuide{
		"node": {
			Tool:        "node",
			DisplayName: "Node.js",
			URL:         "https://nodejs.org/en/download",
			Note:        "下载 LTS 版本（.msi 安装包），双击运行，一路默认选项即可。安装完成后重新打开启动器。",
			Steps: []string{
				"打开下载页面，点击左侧 LTS 版本下载 Windows Installer (.msi)",
				"双击下载的 .msi 文件运行安装向导",
				"勾选 'Automatically install the necessary tools' 选项",
				"一路点 Next，保持默认设置",
				"安装完成后，关闭并重新打开 Satori-Launcher.exe",
			},
		},
		"python": {
			Tool:        "python",
			DisplayName: "Python 3.12",
			URL:         "https://www.python.org/downloads/release/python-3129/",
			Note:        "下载 Windows installer (64-bit)。⚠️ 安装第一页务必勾选 'Add Python to PATH'，否则启动器找不到 Python。",
			Steps: []string{
				"打开下载页面，拉到页面底部 Files 区域",
				"下载 'Windows installer (64-bit)'",
				"⚠️ 关键步骤：安装向导第一页，勾选底部的 'Add Python to PATH'",
				"点击 Install Now，等待安装完成",
				"安装完成后，关闭并重新打开 Satori-Launcher.exe",
			},
		},
		"python313": {
			Tool:        "python313",
			DisplayName: "Python 3.13",
			URL:         "https://www.python.org/downloads/",
			Note:        "下载最新 Python 3.13.x Windows installer (64-bit)。同样务必勾选 'Add Python to PATH'。",
			Steps: []string{
				"打开页面后点击黄色的 'Download Python 3.13.x' 按钮",
				"⚠️ 关键步骤：安装向导第一页，勾选底部的 'Add Python to PATH'",
				"点击 Install Now，等待安装完成",
				"安装完成后，关闭并重新打开 Satori-Launcher.exe",
			},
		},
		"git": {
			Tool:        "git",
			DisplayName: "Git for Windows",
			URL:         "https://git-scm.com/download/win",
			Note:        "下载页面会自动弹窗下载。双击运行，全部使用默认选项即可，无需修改任何设置。",
			Steps: []string{
				"打开页面后会自动开始下载，如未自动下载点击 'Click here to download manually'",
				"双击下载的 .exe 文件运行安装向导",
				"一路点 Next，保持所有默认选项",
				"安装完成后，关闭并重新打开 Satori-Launcher.exe",
			},
		},
	}

	guide, ok := guides[tool]
	if !ok {
		http.Error(w, "unknown tool", http.StatusNotFound)
		return
	}
	writeJSON(w, guide)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
