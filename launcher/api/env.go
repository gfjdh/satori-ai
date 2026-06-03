package api

import (
	"net/http"
	"satori-launcher/svc"
)

func (s *Server) handleEnv(w http.ResponseWriter, r *http.Request) {
	result := svc.DetectAll(s.rootDir)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleEnvGuide(w http.ResponseWriter, r *http.Request) {
	tool := r.PathValue("tool")
	writeJSON(w, http.StatusOK, map[string]string{
		"tool": tool,
		"guide": guideFor(tool),
	})
}

func guideFor(tool string) string {
	switch tool {
	case "node":
		return "请从 https://nodejs.org/zh-cn/download/ 下载 Node.js v24 LTS 安装包。安装完成后重启启动器即可自动检测。"
	case "python":
		return "请从 https://www.python.org/downloads/ 下载 Python 3.12 或 3.13。安装时请勾选「Add Python to PATH」，然后重启启动器。"
	case "git":
		return "请从 https://git-scm.com/download/win 下载 Git for Windows。安装使用默认选项即可，完成后重启启动器。"
	default:
		return "使用启动器「环境」页面的一键下载功能即可自动安装所需运行时。如遇网络问题，请检查代理设置后重试。"
	}
}
