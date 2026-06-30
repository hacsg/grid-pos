// Package logx is a tiny structured-logging shim backed by the standard
// library log package. It exists so the daemon can be built with Go 1.20,
// the last Go release that supports Windows 7 / Server 2008. The standard
// log/slog package is only available in Go 1.21+, which produces binaries
// that crash on Windows 7 with Exception 0xc0000005 (ProcessPrng is absent
// from bcryptprimitives.dll on that OS).
package logx

import (
	"fmt"
	"io"
	"log"
	"strings"
)

// Logger emits "LEVEL message key=value ..." lines, matching the format the
// previous slog.NewTextHandler-based logger produced for these call sites.
type Logger struct{ l *log.Logger }

// New returns a Logger writing to w.
func New(w io.Writer) *Logger {
	return &Logger{l: log.New(w, "", log.LstdFlags)}
}

func (lg *Logger) emit(level, msg string, args ...any) {
	var sb strings.Builder
	sb.WriteString(level)
	sb.WriteByte(' ')
	sb.WriteString(msg)
	for i := 0; i+1 < len(args); i += 2 {
		fmt.Fprintf(&sb, " %v=%v", args[i], args[i+1])
	}
	lg.l.Println(sb.String())
}

func (lg *Logger) Info(msg string, args ...any)  { lg.emit("INFO", msg, args...) }
func (lg *Logger) Warn(msg string, args ...any)  { lg.emit("WARN", msg, args...) }
func (lg *Logger) Error(msg string, args ...any) { lg.emit("ERROR", msg, args...) }
