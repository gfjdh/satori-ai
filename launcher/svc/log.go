package svc

import (
	"fmt"
	"sync"
	"time"
)

type LogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Service string `json:"service,omitempty"`
	Message string `json:"message"`
}

var (
	logSubscribers   []chan LogEntry
	logSubscribersMu sync.Mutex
	logBuffer        []LogEntry
	logBufMu         sync.RWMutex
)

const maxLogBuffer = 10000

func SubscribeLogs() chan LogEntry {
	ch := make(chan LogEntry, 256)
	logSubscribersMu.Lock()
	logSubscribers = append(logSubscribers, ch)
	logSubscribersMu.Unlock()

	// replay existing buffer
	logBufMu.RLock()
	for _, e := range logBuffer {
		select {
		case ch <- e:
		default:
		}
	}
	logBufMu.RUnlock()
	return ch
}

func UnsubscribeLogs(ch chan LogEntry) {
	logSubscribersMu.Lock()
	defer logSubscribersMu.Unlock()
	for i, sub := range logSubscribers {
		if sub == ch {
			logSubscribers = append(logSubscribers[:i], logSubscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

func emitLog(entry LogEntry) {
	entry.Time = time.Now().Format("15:04:05")

	logBufMu.Lock()
	logBuffer = append(logBuffer, entry)
	if len(logBuffer) > maxLogBuffer {
		logBuffer = logBuffer[len(logBuffer)-maxLogBuffer:]
	}
	logBufMu.Unlock()

	logSubscribersMu.Lock()
	defer logSubscribersMu.Unlock()
	for _, ch := range logSubscribers {
		select {
		case ch <- entry:
		default:
		}
	}
}

func LogInfo(service, format string, args ...interface{}) {
	emitLog(LogEntry{
		Level:   "info",
		Service: service,
		Message: fmt.Sprintf(format, args...),
	})
}

func LogError(format string, args ...interface{}) {
	emitLog(LogEntry{
		Level:   "error",
		Message: fmt.Sprintf(format, args...),
	})
}

func LogService(service, format string, args ...interface{}) {
	emitLog(LogEntry{
		Level:   "info",
		Service: service,
		Message: fmt.Sprintf(format, args...),
	})
}
