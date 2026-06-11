"""
Browser Service - WebView automation via Playwright

Architecture (aligned with Alife's WebViewWorker):
  - Dedicated worker thread for ALL Playwright operations
  - queue.Queue serializes tasks (mirrors Alife's BlockingCollection)
  - Browser errors (greenlet, target closed, etc.) trigger automatic recreation + retry

Config:
  - BROWSER_HEADLESS env var (default "true"): set to "false" to show the browser window

POST /navigate    { url }                    -> { title, url }
POST /observe     { page? }                  -> { title, url, textPages, buttonPages, currentPage, text, buttons, inputs }
POST /execute_js  { script }                 -> { result, consoleOutput }
POST /click       { selector }               -> { ok, url, title }
POST /type        { selector, text }         -> { ok, url }
GET  /config                                -> { headless: bool }
POST /set_headless { headless: bool }        -> { ok, headless: bool } (requires browser restart)
"""

import json
import sys
import os
import re
import base64
import logging
import urllib.parse
import threading
import queue
import traceback
from pathlib import Path
from flask import Flask, request, jsonify

# Suppress werkzeug access logs (health check polling noise)
logging.getLogger('werkzeug').setLevel(logging.WARNING)

# ── Load .env ─────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
from playwright_stealth import Stealth
_stealth = Stealth()

app = Flask(__name__)

TEXT_PAGE_SIZE = 1000
BUTTON_PAGE_SIZE = 20

# ----- JS injection for page observation -----

OBSERVE_JS = r"""
(() => {
    let idCounter = 0;

    function getVisibleTexts() {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            { acceptNode: node => {
                const style = window.getComputedStyle(node.parentElement);
                if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }}
        );
        const texts = [];
        let node;
        while (node = walker.nextNode()) {
            const t = node.textContent.trim();
            if (t.length > 0) texts.push(t);
        }
        return texts;
    }

    function getInteractiveElements() {
        const inputs = [];
        const buttons = [];
        const selectors = 'input:not([type="hidden"]), textarea, select, button, a[href], [role="button"], [onclick]';

        document.querySelectorAll(selectors).forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const tag = el.tagName.toLowerCase();
            const dataId = 'el-' + (idCounter++);
            el.setAttribute('data-alife-id', dataId);

            const info = {
                id: dataId,
                tag: tag,
                type: el.getAttribute('type') || '',
                placeholder: el.getAttribute('placeholder') || '',
                text: (el.textContent || el.value || '').trim().substring(0, 100),
                href: el.getAttribute('href') || ''
            };

            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                inputs.push(info);
            } else {
                buttons.push(info);
            }
        });

        return { inputs, buttons, textCount: inputs.length + buttons.length };
    }

    const rawTexts = getVisibleTexts();
    const text = rawTexts.join('\n');
    const { inputs, buttons } = getInteractiveElements();

    const textPages = [];
    let current = '';
    for (const t of rawTexts) {
        if (current.length + t.length > 1000 && current.length > 0) {
            textPages.push(current);
            current = t;
        } else {
            current += (current ? '\n' : '') + t;
        }
    }
    if (current) textPages.push(current);

    const buttonPages = [];
    for (let i = 0; i < buttons.length; i += 20) {
        buttonPages.push(buttons.slice(i, i + 20));
    }

    return {
        title: document.title,
        url: location.href,
        textPagesCount: textPages.length,
        buttonPagesCount: buttonPages.length,
        currentTextPage: 0,
        currentButtonPage: 0,
        text: textPages[0] || '',
        buttons: buttonPages[0] || [],
        inputs: inputs
    };
})()
"""

PAGE_JS_TEMPLATE = r"""
(() => {
    const walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_TEXT,
        { acceptNode: node => {
            const style = window.getComputedStyle(node.parentElement);
            return (style.display === 'none' || style.visibility === 'hidden') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }}
    );
    const rawTexts = [];
    let node;
    while (node = walker.nextNode()) {
        const t = node.textContent.trim();
        if (t.length > 0) rawTexts.push(t);
    }

    const textPages = [];
    let current = '';
    for (const t of rawTexts) {
        if (current.length + t.length > 1000 && current.length > 0) {
            textPages.push(current);
            current = t;
        } else {
            current += (current ? '\n' : '') + t;
        }
    }
    if (current) textPages.push(current);

    const buttons = [];
    document.querySelectorAll('[data-alife-id]').forEach(el => {
        buttons.push({
            id: el.getAttribute('data-alife-id'),
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.value || '').trim().substring(0, 100)
        });
    });

    const btnPages = [];
    for (let i = 0; i < buttons.length; i += 20) {
        btnPages.push(buttons.slice(i, i + 20));
    }

    const pageIdx = %d;
    return {
        text: textPages[pageIdx] || '',
        buttons: btnPages[pageIdx] || [],
        textPagesCount: textPages.length,
        buttonPagesCount: btnPages.length
    };
})()
"""

# ============================================================
# BrowserWorker — dedicated thread for all Playwright operations
# Mirrors Alife's WebViewWorker: single thread + task queue
# ============================================================

class BrowserWorker:
    def __init__(self, headless=True):
        self._task_queue = queue.Queue()
        self._pw = None
        self._browser = None
        self._page = None
        self._ready = threading.Event()
        self._running = True
        self._headless = headless
        self._ok = False

        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    @property
    def ready(self):
        return self._ready.is_set() and self._ok

    @property
    def headless(self):
        return self._headless

    def execute(self, fn, timeout=30):
        """Submit a task to the worker thread and wait for result."""
        result_queue = queue.Queue()
        self._task_queue.put((fn, result_queue))
        try:
            ok, value = result_queue.get(timeout=timeout)
        except queue.Empty:
            return False, "Browser operation timed out after {}s".format(timeout)
        if ok:
            return True, value
        else:
            return False, value

    def shutdown(self):
        self._running = False
        self._task_queue.put((None, None))  # wake up worker

    def _run(self):
        """Main worker loop — runs on the dedicated Playwright thread."""
        from playwright.sync_api import sync_playwright

        try:
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(
                headless=self._headless,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                ]
            )
            context = self._browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080},
                locale='ja-JP',
            )
            self._page = context.new_page()
            _stealth.apply_stealth_sync(self._page)
            self._ok = True
            self._ready.set()
            print(f"[BrowserWorker] Playwright initialized (headless={self._headless})")
        except Exception as e:
            print(f"[BrowserWorker] Failed to start Playwright: {e}")
            self._ready.set()
            self._ok = False
            return

        while self._running:
            try:
                fn, result_queue = self._task_queue.get(timeout=1)
            except queue.Empty:
                continue

            if fn is None:
                break  # shutdown signal

            try:
                result = fn(self._page)
                result_queue.put((True, result))
            except Exception as e:
                msg = str(e)
                should_recreate = (
                    'greenlet' in msg.lower()
                    or 'cannot switch' in msg.lower()
                    or 'target closed' in msg.lower()
                    or 'browser has been closed' in msg.lower()
                    or 'target page' in msg.lower()
                )
                if should_recreate:
                    print(f"[BrowserWorker] Browser error, recreating: {msg}")
                    traceback.print_exc()
                    try:
                        self._page.close()
                    except Exception:
                        pass
                    try:
                        self._browser.close()
                    except Exception:
                        pass
                    try:
                        self._pw.stop()
                    except Exception:
                        pass
                    try:
                        from playwright.sync_api import sync_playwright
                        self._pw = sync_playwright().start()
                        self._browser = self._pw.chromium.launch(
                            headless=self._headless,
                            args=[
                                '--disable-blink-features=AutomationControlled',
                                '--no-sandbox',
                                '--disable-dev-shm-usage',
                            ]
                        )
                        context = self._browser.new_context(
                            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                            viewport={'width': 1920, 'height': 1080},
                            locale='ja-JP',
                        )
                        self._page = context.new_page()
                        _stealth.apply_stealth_sync(self._page)
                        print(f"[BrowserWorker] Browser recreated (headless={self._headless}), retrying task")
                        result = fn(self._page)
                        result_queue.put((True, result))
                    except Exception as e2:
                        result_queue.put((False, f"Browser recovery failed: {e2}"))
                else:
                    traceback.print_exc()
                    result_queue.put((False, str(e)))

        # Cleanup
        try:
            self._page.close()
        except Exception:
            pass
        try:
            self._browser.close()
        except Exception:
            pass
        try:
            self._pw.stop()
        except Exception:
            pass
        print("[BrowserWorker] Shutdown complete")

# Global worker instance
_worker = None
_headless_mode = os.environ.get('BROWSER_HEADLESS', 'true').lower() != 'false'

def get_worker():
    global _worker
    if _worker is None or not _worker.ready:
        _worker = BrowserWorker(headless=_headless_mode)
        _worker._ready.wait(timeout=10)
    return _worker

# ----- Routes -----

@app.route('/health', methods=['GET'])
def health():
    w = _worker
    browser_ok = w is not None and w.ready
    return jsonify({'status': 'ok' if browser_ok else 'initializing', 'browser': browser_ok})

@app.route('/navigate', methods=['POST'])
def navigate():
    data = request.get_json()
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url is required'}), 400
    if not url.startswith('http'):
        url = 'https://' + url

    def _do(page):
        page.goto(url, wait_until='domcontentloaded', timeout=30000)
        # Wait for any post-load redirects (Bing adds rdr params)
        try:
            page.wait_for_load_state('networkidle', timeout=5000)
        except Exception:
            pass
        title = page.title()
        return {'title': title, 'url': page.url}

    ok, result = get_worker().execute(_do)
    if ok:
        return jsonify(result)
    return jsonify({'error': result}), 500

@app.route('/observe', methods=['POST'])
def observe():
    data = request.get_json() or {}
    page_idx = data.get('page', 0)

    def _do(page):
        # Wait for any pending navigation to stabilize, with retry on race condition
        for attempt in range(3):
            try:
                page.wait_for_load_state('domcontentloaded', timeout=5000)
            except Exception:
                pass
            try:
                if page_idx == 0 or page_idx is None:
                    result = page.evaluate(OBSERVE_JS)
                else:
                    result = page.evaluate(PAGE_JS_TEMPLATE % page_idx)
                    inputs_result = page.evaluate(r"""
                        (() => {
                            const inputs = [];
                            document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(el => {
                                const rect = el.getBoundingClientRect();
                                if (rect.width === 0 || rect.height === 0) return;
                                inputs.push({
                                    id: el.getAttribute('data-alife-id') || '',
                                    tag: el.tagName.toLowerCase(),
                                    type: el.getAttribute('type') || '',
                                    placeholder: el.getAttribute('placeholder') || '',
                                    text: (el.value || '').trim().substring(0, 100)
                                });
                            });
                            return inputs;
                        })()
                    """)
                    result['inputs'] = inputs_result
                return result
            except Exception as e:
                msg = str(e).lower()
                if ('execution context was destroyed' in msg or 'target page' in msg) and attempt < 2:
                    try:
                        page.wait_for_load_state('domcontentloaded', timeout=10000)
                    except Exception:
                        pass
                    continue
                raise

    ok, result = get_worker().execute(_do)
    if ok:
        return jsonify(result)
    return jsonify({'error': result}), 500

@app.route('/execute_js', methods=['POST'])
def execute_js():
    data = request.get_json()
    script = data.get('script', '').strip()
    if not script:
        return jsonify({'error': 'script is required'}), 400

    def _do(page):
        wrapped = f"""
        (() => {{
            const logs = [];
            const origLog = console.log;
            console.log = (...args) => {{ logs.push(args.map(String).join(' ')); origLog.apply(console, args); }};
            try {{
                const __result = (() => {{ {script} }})();
                console.log = origLog;
                return {{ result: __result, consoleOutput: logs }};
            }} catch(e) {{
                console.log = origLog;
                return {{ error: e.message, consoleOutput: logs }};
            }}
        }})()
        """
        result_page = page.evaluate(wrapped)
        return result_page

    ok, result = get_worker().execute(_do)
    if ok:
        return jsonify(result)
    return jsonify({'error': result}), 500

@app.route('/click', methods=['POST'])
def click():
    data = request.get_json()
    selector = data.get('selector', '').strip()
    if not selector:
        return jsonify({'error': 'selector is required'}), 400

    def _do(page):
        sel = selector
        if sel.startswith('el-') or sel.startswith('[data-alife-id'):
            if not sel.startswith('['):
                sel = f'[data-alife-id="{sel}"]'
        url_before = page.url
        pages_before = page.context.pages
        # Try to wait for navigation if click triggers one
        try:
            with page.expect_navigation(timeout=5000):
                page.click(sel, timeout=10000)
        except Exception:
            # No navigation on current page — still do the click
            page.click(sel, timeout=10000)
        # Check if a new tab was opened
        pages_after = page.context.pages
        new_pages = [p for p in pages_after if p not in pages_before]
        if new_pages:
            new_page = new_pages[-1]
            try:
                new_page.wait_for_load_state('domcontentloaded', timeout=10000)
            except Exception:
                pass
            title = new_page.title()
            url = new_page.url
            new_page.bring_to_front()
            if page != new_page:
                try:
                    page.close()
                except Exception:
                    pass
            return {'ok': True, 'url': url, 'title': title}
        # If URL still unchanged, try href fallback (for JS-driven links like Bing)
        if page.url == url_before:
            href = page.evaluate(f"""(selector) => {{
                const el = document.querySelector(selector);
                return el ? (el.getAttribute('href') || el.closest('a')?.getAttribute('href') || '') : '';
            }}""", sel)
            if href and not href.startswith('javascript:') and href != '#':
                # Decode Bing redirect URLs to extract real target
                if '/ck/a' in href or '/rdr/' in href:
                    parsed = urllib.parse.urlparse(href)
                    params = urllib.parse.parse_qs(parsed.query)
                    u_param = params.get('u', [None])[0]
                    if u_param:
                        try:
                            decoded = base64.b64decode(u_param).decode('utf-8')
                            if decoded.startswith('http'):
                                href = decoded
                        except Exception:
                            pass
                page.goto(href, wait_until='domcontentloaded', timeout=30000)
                try:
                    page.wait_for_load_state('networkidle', timeout=5000)
                except Exception:
                    pass
                return {'ok': True, 'url': page.url, 'title': page.title()}
            # For submit buttons / inputs: try pressing Enter in the associated form
            tag = page.evaluate(f"""(selector) => {{
                const el = document.querySelector(selector);
                return el ? el.tagName.toLowerCase() : '';
            }}""", sel)
            if tag in ('input', 'button', 'textarea'):
                page.keyboard.press('Enter')
                try:
                    page.wait_for_load_state('domcontentloaded', timeout=10000)
                except Exception:
                    pass
        return {'ok': True, 'url': page.url, 'title': page.title()}

    ok, result = get_worker().execute(_do)
    if ok:
        return jsonify(result)
    return jsonify({'error': result}), 500

@app.route('/type', methods=['POST'])
def type_text():
    data = request.get_json()
    selector = data.get('selector', '').strip()
    text = data.get('text', '')
    if not selector:
        return jsonify({'error': 'selector is required'}), 400

    def _do(page):
        sel = selector
        if not sel.startswith('[') and sel.startswith('el-'):
            sel = f'[data-alife-id="{sel}"]'
        page.fill(sel, text, timeout=10000)
        return {'ok': True, 'url': page.url}

    ok, result = get_worker().execute(_do)
    if ok:
        return jsonify(result)
    return jsonify({'error': result}), 500

# ----- Config endpoints -----

@app.route('/config', methods=['GET'])
def get_config():
    return jsonify({'headless': _headless_mode})

@app.route('/set_headless', methods=['POST'])
def set_headless():
    global _worker, _headless_mode
    data = request.get_json()
    if data is None or 'headless' not in data:
        return jsonify({'error': 'headless field is required (bool)'}), 400

    new_headless = bool(data['headless'])
    if new_headless == _headless_mode:
        return jsonify({'ok': True, 'headless': _headless_mode, 'restarted': False})

    _headless_mode = new_headless
    if _worker:
        _worker.shutdown()
        _worker = None
    _worker = BrowserWorker(headless=_headless_mode)
    _worker._ready.wait(timeout=10)
    return jsonify({'ok': True, 'headless': _headless_mode, 'restarted': True})

# ----- Startup -----

def main():
    port = int(os.environ.get('BROWSER_SERVICE_PORT', 8743))

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed. Run: pip install playwright && playwright install chromium")
        sys.exit(1)

    # Write PID file so start.ps1 can kill instantly without WMI lookup
    pid_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.pid')
    with open(pid_file, 'w') as f:
        f.write(str(os.getpid()))

    print(f"Starting browser service on port {port}...")
    # Pre-initialize worker
    get_worker()
    print("Browser ready. Launching Flask...")
    try:
        app.run(host='127.0.0.1', port=port, debug=False)
    finally:
        try:
            os.remove(pid_file)
        except OSError:
            pass

if __name__ == '__main__':
    main()
