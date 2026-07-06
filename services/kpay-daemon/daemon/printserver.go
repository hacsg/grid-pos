package daemon

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"kpay-daemon/config"
	"kpay-daemon/logx"
	"kpay-daemon/printer"
)

// StartPrintServer exposes the local receipt-print HTTP service the POS web
// app falls back to when WebUSB cannot reach the printer (e.g. built-in
// printers on internal serial wiring). It prints through the Windows spooler
// with the driver Windows already has, so no driver changes are needed.
//
//	GET  /print/health -> {"ok":true,"printer":"<resolved name or default>"}
//	POST /print        -> {"text":"..."} prints ESC/POS receipt (init+cut)
//	POST /drawer       -> {} pulses the cash drawer via the printer's RJ11 port
//
// The browser page is HTTPS and this service is plain-HTTP loopback, so every
// response carries permissive CORS headers plus Access-Control-Allow-Private-
// Network for Chrome's private network access preflights. Binding is loopback
// by default (PRINTER_HTTP_ADDR), so "permissive" still means same-machine.
func StartPrintServer(cfg config.Config, log *logx.Logger) *http.Server {
	if cfg.PrinterHTTPAddr == "off" {
		return nil
	}
	mux := http.NewServeMux()
	handle := func(path string, fn func(w http.ResponseWriter, r *http.Request)) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Allow-Private-Network", "true")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			fn(w, r)
		})
	}
	respond := func(w http.ResponseWriter, err error) {
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}

	handle("/print/health", func(w http.ResponseWriter, r *http.Request) {
		name := cfg.PrinterName
		if name == "" {
			if def, err := printer.DefaultPrinterName(); err == nil {
				name = def
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "printer": name})
	})
	handle("/print", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Text == "" {
			http.Error(w, "expected JSON body with non-empty \"text\"", http.StatusBadRequest)
			return
		}
		err := printer.PrintRaw(cfg.PrinterName, printer.BuildPrintPayload(body.Text))
		if err != nil {
			log.Warn("receipt print failed", "error", err)
		}
		respond(w, err)
	})
	handle("/print-raw", func(w http.ResponseWriter, r *http.Request) {
		// Pre-built ESC/POS payload (base64) — used by the kitchen chit, which
		// carries its own font-size/emphasis control codes. Printed verbatim.
		var body struct {
			B64 string `json:"b64"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.B64 == "" {
			http.Error(w, "expected JSON body with non-empty \"b64\"", http.StatusBadRequest)
			return
		}
		raw, derr := base64.StdEncoding.DecodeString(body.B64)
		if derr != nil {
			http.Error(w, "invalid base64", http.StatusBadRequest)
			return
		}
		err := printer.PrintRaw(cfg.PrinterName, raw)
		if err != nil {
			log.Warn("raw print failed", "error", err)
		}
		respond(w, err)
	})
	handle("/drawer", func(w http.ResponseWriter, r *http.Request) {
		err := printer.PrintRaw(cfg.PrinterName, printer.BuildDrawerPulsePayload(cfg.DrawerPin))
		if err != nil {
			log.Warn("drawer kick failed", "error", err)
		}
		respond(w, err)
	})

	srv := &http.Server{Addr: cfg.PrinterHTTPAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("print service failed", "addr", cfg.PrinterHTTPAddr, "error", err)
		}
	}()
	log.Info("print service listening", "addr", cfg.PrinterHTTPAddr)
	return srv
}
