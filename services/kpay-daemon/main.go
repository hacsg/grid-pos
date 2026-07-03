package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kpay-daemon/config"
	"kpay-daemon/daemon"
	"kpay-daemon/kpay"
	"kpay-daemon/logx"
)

func main() {
	log := logx.New(os.Stdout)
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Error("config invalid", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	state := daemon.NewState()
	client := kpay.NewClient(kpay.Options{
		TerminalBaseURL: cfg.TerminalBaseURL(),
		AppID:           cfg.AppID,
		AppSecret:       cfg.AppSecret,
		ManagerPassword: cfg.ManagerPassword,
	}, state, state)
	handler := daemon.NewHandler(client, log)

	if cfg.LocalTest {
		srv := handler.StartLocal(":9000")
		log.Info("local test server listening", "addr", ":9000")
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		return
	}
	go daemon.RunReconciliationLoop(ctx, cfg, client, log)
	if err := daemon.Run(ctx, cfg, handler, log); err != nil && !errors.Is(err, context.Canceled) {
		log.Error("daemon stopped", "error", err)
		os.Exit(1)
	}
}
