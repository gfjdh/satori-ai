"""
Browser Service - WebView automation via Playwright

Provides a headless browser that the AI can navigate, observe, and interact with.
Inspired by Alife's SurfingService: paginated content extraction with element tagging.

POST /navigate    { url }                    -> { title, url }
POST /observe     { page? }                  -> { title, url, textPages, buttonPages, currentPage, text, buttons, inputs }
POST /execute_js  { script }                 -> { result, consoleOutput }
POST /click       { selector }               -> { ok }
POST /type        { selector, text }         -> { ok }
"""

import json
import sys
import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Playwright is imported lazily to give clear error message if not installed
browser = None
page = None
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

    // Paginate text
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

    // Paginate buttons
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

# ----- Routes -----

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'browser': browser is not None})

@app.route('/navigate', methods=['POST'])
def navigate():
    global page
    data = request.get_json()
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url is required'}), 400
    if not url.startswith('http'):
        url = 'https://' + url

    try:
        page.goto(url, wait_until='domcontentloaded', timeout=30000)
        title = page.title()
        return jsonify({'title': title, 'url': page.url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/observe', methods=['POST'])
def observe():
    global page
    data = request.get_json() or {}
    page_idx = data.get('page', 0)

    try:
        # For page 0, do full observation including element tagging
        if page_idx == 0 or page_idx is None:
            result = page.evaluate(OBSERVE_JS)
        else:
            result = page.evaluate(PAGE_JS_TEMPLATE % page_idx)
            # Re-fetch inputs for consistency
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

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/execute_js', methods=['POST'])
def execute_js():
    global page
    data = request.get_json()
    script = data.get('script', '').strip()
    if not script:
        return jsonify({'error': 'script is required'}), 400

    try:
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
        result = page.evaluate(wrapped)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/click', methods=['POST'])
def click():
    global page
    data = request.get_json()
    selector = data.get('selector', '').strip()
    if not selector:
        return jsonify({'error': 'selector is required'}), 400

    try:
        # Support data-alife-id selectors
        if selector.startswith('el-') or selector.startswith('[data-alife-id'):
            if not selector.startswith('['):
                selector = f'[data-alife-id="{selector}"]'
        page.click(selector, timeout=10000)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/type', methods=['POST'])
def type_text():
    global page
    data = request.get_json()
    selector = data.get('selector', '').strip()
    text = data.get('text', '')
    if not selector:
        return jsonify({'error': 'selector is required'}), 400

    try:
        if not selector.startswith('[') and selector.startswith('el-'):
            selector = f'[data-alife-id="{selector}"]'
        page.fill(selector, text, timeout=10000)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ----- Startup -----

def main():
    global browser, page

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed. Run: pip install playwright && playwright install chromium")
        sys.exit(1)

    port = int(os.environ.get('BROWSER_SERVICE_PORT', 8743))

    print(f"Starting browser service on port {port}...")
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page()

    print("Browser ready. Launching Flask...")
    app.run(host='127.0.0.1', port=port, debug=False)

if __name__ == '__main__':
    main()
