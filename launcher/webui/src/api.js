const API = '/api'

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(API + path, opts)
  const data = await res.json()
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText)
  return data
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function apiGet(path) { return request('GET', path) }
export function apiPost(path, body) { return request('POST', path, body) }

export function apiSSE(path, onEvent) {
  const es = new EventSource(API + path)
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)) } catch (_) { onEvent(e.data) }
  }
  es.onerror = () => es.close()
  return es
}

export function apiSSEPost(path, body, onEvent) {
  return fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(response => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    function pump() {
      reader.read().then(({ done, value }) => {
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { onEvent(JSON.parse(line.slice(6))) } catch (_) {}
          }
        }
        pump()
      })
    }
    pump()
  })
}
