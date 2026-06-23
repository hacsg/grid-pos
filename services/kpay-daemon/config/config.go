package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct{ OutletID, RailwayWSURL, DaemonToken, TerminalIP, AppID, AppSecret, ManagerPassword string; LocalTest bool }

func Load() Config {
	return Config{os.Getenv("OUTLET_ID"), os.Getenv("RAILWAY_WS_URL"), os.Getenv("DAEMON_AUTH_TOKEN"), os.Getenv("KPAT_TERMINAL_IP"), os.Getenv("KPAT_APP_ID"), os.Getenv("KPAT_APP_SECRET"), os.Getenv("KPAT_MANAGER_PASSWORD"), os.Getenv("KPAY_LOCAL_TEST") == "1"}
}

func (c Config) Validate() error {
	req := [][2]string{{"KPAT_TERMINAL_IP", c.TerminalIP}, {"KPAT_APP_ID", c.AppID}, {"KPAT_APP_SECRET", c.AppSecret}, {"KPAT_MANAGER_PASSWORD", c.ManagerPassword}}
	if !c.LocalTest { req = append(req, [2]string{"OUTLET_ID", c.OutletID}, [2]string{"RAILWAY_WS_URL", c.RailwayWSURL}, [2]string{"DAEMON_AUTH_TOKEN", c.DaemonToken}) }
	var miss []string
	for _, kv := range req { if strings.TrimSpace(kv[1]) == "" { miss = append(miss, kv[0]) } }
	if len(miss) > 0 { return fmt.Errorf("missing required env: %s", strings.Join(miss, ", ")) }
	return nil
}

func (c Config) TerminalBaseURL() string {
	if strings.HasPrefix(c.TerminalIP, "http://") || strings.HasPrefix(c.TerminalIP, "https://") { return strings.TrimRight(c.TerminalIP, "/") }
	return "http://" + strings.TrimRight(c.TerminalIP, "/") + ":18080"
}

func (c Config) DaemonWSURL() (string, error) {
	u, err := url.Parse(c.RailwayWSURL); if err != nil { return "", err }
	if u.Path == "" || u.Path == "/" { u.Path = "/ws/daemon" }
	q := u.Query(); if q.Get("outlet_id") == "" { q.Set("outlet_id", c.OutletID) }; if q.Get("token") == "" { q.Set("token", c.DaemonToken) }
	u.RawQuery = q.Encode(); return u.String(), nil
}
