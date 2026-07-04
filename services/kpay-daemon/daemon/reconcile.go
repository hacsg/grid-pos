package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"kpay-daemon/logx"
	"net/http"
	"strings"
	"time"

	"kpay-daemon/config"
	"kpay-daemon/kpay"
)

type reconciliationCandidate struct {
	ID         string `json:"id"`
	OutTradeNo string `json:"out_trade_no"`
	OrderID    string `json:"order_id"`
	Status     string `json:"status"`
}

type reconcileRequest struct {
	OutTradeNo    string `json:"out_trade_no"`
	PayResult     int    `json:"pay_result"`
	TransactionNo string `json:"transaction_no"`
	RefNo         string `json:"ref_no"`
	PayMethod     int    `json:"pay_method"`
	Reason        string `json:"reason"`
}

func RunReconciliationLoop(ctx context.Context, cfg config.Config, client *kpay.Client, log *logx.Logger) {
	if cfg.LocalTest {
		return
	}
	apiBase, err := cfg.BackendAPIURL()
	if err != nil {
		log.Warn("reconciliation disabled: backend API URL unavailable", "error", err)
		return
	}
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	log.Info("reconciliation loop started", "api", apiBase)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := reconcileStaleIntents(ctx, cfg, client, apiBase, log); err != nil {
				log.Warn("reconciliation pass failed", "error", err)
			}
		}
	}
}

func reconcileStaleIntents(ctx context.Context, cfg config.Config, client *kpay.Client, apiBase string, log *logx.Logger) error {
	candidates, err := fetchReconciliationCandidates(ctx, apiBase, cfg)
	if err != nil {
		return err
	}
	for _, c := range candidates {
		q, qerr := client.Query(ctx, c.OutTradeNo)
		if qerr != nil {
			log.Warn("terminal query failed during reconciliation", "intent", c.ID, "error", qerr)
			continue
		}
		if err := postReconcileResult(ctx, apiBase, cfg, c.ID, c.OutTradeNo, q); err != nil {
			log.Warn("reconcile post failed", "intent", c.ID, "error", err)
		}
	}
	return nil
}

func fetchReconciliationCandidates(ctx context.Context, apiBase string, cfg config.Config) ([]reconciliationCandidate, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		strings.TrimRight(apiBase, "/")+"/api/kpay/reconciliation-candidates",
		nil,
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Outlet-Id", cfg.OutletID)
	req.Header.Set("X-Daemon-Token", cfg.DaemonToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list candidates: %s", strings.TrimSpace(string(body)))
	}
	var out []reconciliationCandidate
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

func postReconcileResult(ctx context.Context, apiBase string, cfg config.Config, intentID, outTradeNo string, q kpay.QueryData) error {
	payload := reconcileRequest{
		OutTradeNo:    outTradeNo,
		PayResult:     q.PayResult,
		TransactionNo: q.TransactionNo,
		RefNo:         q.RefNo,
		PayMethod:     q.PayMethod,
		Reason:        q.Reason,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		fmt.Sprintf("%s/api/kpay/%s/reconcile", strings.TrimRight(apiBase, "/"), intentID),
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Outlet-Id", cfg.OutletID)
	req.Header.Set("X-Daemon-Token", cfg.DaemonToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("reconcile %s: %s", intentID, strings.TrimSpace(string(b)))
	}
	return nil
}
