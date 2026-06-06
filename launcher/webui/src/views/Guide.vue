<template>
  <div>
    <h1 class="page-title">Guide</h1>

    <div class="card">
      <div class="card-title">Quick Start</div>
      <ol style="padding-left:20px;line-height:2;font-size:13px">
        <li>Open <strong>Setup</strong> page and check runtime environment</li>
        <li>Click <strong>Install All</strong> to initialize all services</li>
        <li>Configure your LLM API key in the API Config step</li>
        <li>Click <strong>Start All</strong> to launch all services</li>
        <li>Open <strong>http://localhost:3682</strong> to access Satori AI</li>
      </ol>
    </div>

    <div class="card">
      <div class="card-title">FAQ</div>

      <h3 style="font-size:14px;margin:12px 0 4px">Why does ASR use Python 3.12 while others use 3.13?</h3>
      <p class="text-dim" style="margin-bottom:12px">
        The funasr-onnx C extension is not yet compatible with Python 3.13.
        This is a known limitation that will be resolved when funasr-onnx releases a 3.13-compatible version.
      </p>

      <h3 style="font-size:14px;margin:12px 0 4px">Setup failed with "pip install failed"</h3>
      <p class="text-dim" style="margin-bottom:12px">
        Check your network connection. If behind a proxy, set HTTP_PROXY/HTTPS_PROXY environment variables.
        You can retry by clicking "Reinstall" on the Services page.
      </p>

      <h3 style="font-size:14px;margin:12px 0 4px">Port already in use</h3>
      <p class="text-dim" style="margin-bottom:12px">
        The launcher tries to clear occupied ports on startup. If this fails,
        manually terminate the process using the port (check with <code>netstat -ano | findstr :PORT</code>)
        and restart the launcher.
      </p>

      <h3 style="font-size:14px;margin:12px 0 4px">Services show "Degraded mode"</h3>
      <p class="text-dim" style="margin-bottom:12px">
        Windows Job Object creation failed (possibly due to EDR/AppLocker software).
        Services will still work, but orphan processes may remain when the launcher exits.
        Use Task Manager to clean up if needed.
      </p>

      <h3 style="font-size:14px;margin:12px 0 4px">How do I edit .env manually?</h3>
      <p class="text-dim" style="margin-bottom:12px">
        The <code>.env</code> file is in the distribution package root directory.
        Edit it with any text editor. The Setup page only provides a form for LLM API keys;
        other settings must be edited manually.
      </p>
    </div>

    <div class="card">
      <div class="card-title">Manual Configuration</div>
      <p class="text-dim" style="margin-bottom:8px">
        Copy <code>.env.example</code> to <code>.env</code> and edit the following required fields:
      </p>
      <pre style="background:var(--bg);padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;line-height:1.6">
LLM_API_KEY=sk-your-key-here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4
VISION_LLM_API_KEY=sk-your-key-here
VISION_LLM_BASE_URL=https://api.openai.com/v1
VISION_LLM_MODEL=gpt-4-vision-preview</pre>
    </div>
  </div>
</template>

<script>
export default { name: 'GuideView' }
</script>
