package daemon

import (
	"context"; "encoding/json"; "errors"; "log/slog"; "net/http"; "time"
	"kpay-daemon/kpay"
)

type Sender interface{ Send(any) error }
type Handler struct{ client *kpay.Client; log *slog.Logger }
type Command struct{ Type string `json:"type"`; RequestID string `json:"request_id"`; OutTradeNo string `json:"out_trade_no"`; OriginOutTradeNo string `json:"origin_out_trade_no"`; AmountCents int64 `json:"amount_cents"`; PaymentType int `json:"payment_type"`; RefundType int `json:"refund_type"`; RefundAmount int64 `json:"refund_amount_cents"`; RefNo string `json:"ref_no"`; TransactionNo string `json:"transaction_no"`; CommitTime int64 `json:"commit_time"` }

func NewHandler(c *kpay.Client, log *slog.Logger) *Handler { return &Handler{client: c, log: log} }
func (h *Handler) HandleWS(ctx context.Context, s Sender, raw []byte) {
	for _, ev := range h.Events(ctx, raw) { if err := s.Send(ev); err != nil { h.log.Warn("ws send failed", "error", err); return } }
}

func (h *Handler) Events(ctx context.Context, raw []byte) []any {
	var c Command; if err := json.Unmarshal(raw, &c); err != nil { return []any{errEvent("", err)} }
	switch c.Type {
	case "pong", "": return nil
	case "start_sale": return h.startSale(ctx, c)
	case "query": return h.query(ctx, c, "query_result")
	case "cancel": return h.simple(c, "cancel_result", func() error { return h.client.Cancel(ctx, c.OutTradeNo, c.OriginOutTradeNo) })
	case "refund": return h.simple(c, "refund_result", func() error { return h.client.Refund(ctx, c.OutTradeNo, c.RefundType, c.RefundAmount, c.RefNo, c.TransactionNo, c.CommitTime) })
	default: return []any{errEvent(c.RequestID, errors.New("unknown command type"))}
	}
}

func (h *Handler) startSale(ctx context.Context, c Command) []any {
	if err := h.client.Sales(ctx, c.OutTradeNo, c.AmountCents, c.PaymentType); err != nil { return []any{errEvent(c.RequestID, err)} }
	return append([]any{map[string]any{"type": "sale_started", "request_id": c.RequestID, "status": "accepted"}}, h.query(ctx, c, "sale_result")...)
}

func (h *Handler) query(ctx context.Context, c Command, typ string) []any {
	q, err := h.client.Query(ctx, c.OutTradeNo); if err != nil { return []any{errEvent(c.RequestID, err)} }
	return []any{map[string]any{"type": typ, "request_id": c.RequestID, "out_trade_no": c.OutTradeNo, "pay_result": q.PayResult, "transaction_no": q.TransactionNo, "ref_no": q.RefNo, "pay_method": q.PayMethod}}
}
func (h *Handler) simple(c Command, typ string, fn func() error) []any {
	if err := fn(); err != nil { return []any{errEvent(c.RequestID, err)} }
	return []any{map[string]any{"type": typ, "request_id": c.RequestID, "out_trade_no": c.OutTradeNo, "success": true}}
}
func errEvent(id string, err error) map[string]any {
	code := 50001; var ke *kpay.Error; if errors.As(err, &ke) { code = ke.Code }
	return map[string]any{"type": "error", "request_id": id, "code": code, "message": err.Error()}
}

func (h *Handler) StartLocal(addr string) *http.Server {
	mux := http.NewServeMux(); add := func(path, typ string) { mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		var c Command; if err := json.NewDecoder(r.Body).Decode(&c); err != nil { http.Error(w, err.Error(), http.StatusBadRequest); return }
		c.Type = typ; w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(map[string]any{"events": h.Events(r.Context(), mustJSON(c))})
	})}
	add("/kpay/sales", "start_sale"); add("/kpay/query", "query"); add("/kpay/cancel", "cancel"); add("/kpay/refund", "refund")
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5*time.Second}
	go func() { if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) { h.log.Error("local test server failed", "error", err) } }()
	return srv
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
