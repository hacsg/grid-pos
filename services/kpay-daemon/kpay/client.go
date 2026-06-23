package kpay

import (
	"bytes"; "context"; "crypto/rsa"; "encoding/json"; "errors"; "fmt"; "net/http"; "net/url"; "strings"; "time"
)

type KeyStore interface{ Keys() (*rsa.PrivateKey, *rsa.PublicKey, bool); SetKeys(*rsa.PrivateKey, *rsa.PublicKey); ClearKeys() }
type RateLimiter interface{ Wait(context.Context) error }
type Options struct{ TerminalBaseURL, AppID, AppSecret, ManagerPassword string }
type Client struct{ http *http.Client; opt Options; keys KeyStore; rate RateLimiter }

func NewClient(opt Options, keys KeyStore, rate RateLimiter) *Client {
	opt.TerminalBaseURL = strings.TrimRight(opt.TerminalBaseURL, "/")
	return &Client{http: &http.Client{}, opt: opt, keys: keys, rate: rate}
}

func (c *Client) SignIn(ctx context.Context) error {
	resp, err := send[SignData](c, ctx, "POST", "/v2/pos/sign", SignRequest{c.opt.AppID, c.opt.AppSecret}, false); if err != nil { return err }
	priv, err := ParsePrivateKey(resp.Data.AppPrivateKey); if err != nil { return err }
	pub, err := ParsePublicKey(resp.Data.PlatformPublicKey); if err != nil { return err }
	c.keys.SetKeys(priv, pub); return nil
}

func (c *Client) Sales(ctx context.Context, no string, cents int64, typ int) error {
	ctx, cancel := context.WithTimeout(ctx, 65*time.Second); defer cancel()
	body := SaleRequest{OutTradeNo: no, PayAmount: amount(cents), PayCurrency: "702", PaymentType: typ}
	_, err := signed[struct{}](c, ctx, "POST", "/v2/pos/sales", body); return err
}

func (c *Client) Query(ctx context.Context, no string) (QueryData, error) {
	resp, err := signed[QueryData](c, ctx, "GET", "/v2/pos/query?outTradeNo="+url.QueryEscape(no), nil)
	return resp.Data, err
}

func (c *Client) Cancel(ctx context.Context, no, origin string) error {
	var err error
	for i := 0; i < 2; i++ {
		enc, e := c.encryptedPassword(ctx); if e != nil { return e }
		_, err = send[struct{}](c, ctx, "POST", "/v2/pos/sales/cancel", CancelRequest{OutTradeNo: no, OriginOutTradeNo: origin, ManagerPassword: enc}, true)
		if !isCode(err, CodeKeyExpired) { return err }; c.keys.ClearKeys()
	}
	return err
}

func (c *Client) Refund(ctx context.Context, no string, typ int, cents int64, ref, tx string, commit int64) error {
	var err error
	for i := 0; i < 2; i++ {
		enc, e := c.encryptedPassword(ctx); if e != nil { return e }
		body := RefundRequest{OutTradeNo: no, RefundType: typ, RefundAmount: amount(cents), RefNo: ref, TransactionNo: tx, CommitTime: commit, ManagerPassword: enc}
		_, err = send[struct{}](c, ctx, "POST", "/v2/pos/sales/refund", body, true)
		if !isCode(err, CodeKeyExpired) { return err }; c.keys.ClearKeys()
	}
	return err
}

func signed[T any](c *Client, ctx context.Context, method, path string, body any) (Response[T], error) {
	var resp Response[T]; var err error
	for i := 0; i < 2; i++ {
		resp, err = send[T](c, ctx, method, path, body, true)
		if !isCode(err, CodeKeyExpired) { return resp, err }; c.keys.ClearKeys()
	}
	return resp, err
}

func send[T any](c *Client, ctx context.Context, method, path string, body any, sign bool) (Response[T], error) {
	var zero Response[T]; var raw []byte; var err error
	if body != nil { raw, err = json.Marshal(body); if err != nil { return zero, err } }
	if sign { if err := c.ensureKeys(ctx); err != nil { return zero, err } }
	if err := c.rate.Wait(ctx); err != nil { return zero, err }
	ts, nonce := TimestampMS(), ""; nonce, err = Nonce(); if err != nil { return zero, err }
	req, err := http.NewRequestWithContext(ctx, method, c.opt.TerminalBaseURL+path, bytes.NewReader(raw)); if err != nil { return zero, err }
	req.Header.Set("timestamp", ts); req.Header.Set("nonceStr", nonce); if body != nil { req.Header.Set("Content-Type", "application/json") }
	if sign {
		priv, _, ok := c.keys.Keys(); if !ok { return zero, fmt.Errorf("missing working key") }
		sig, err := Sign(priv, method, path, ts, nonce, raw); if err != nil { return zero, err }
		req.Header.Set("appId", c.opt.AppID); req.Header.Set("signature", sig)
	}
	httpResp, err := c.http.Do(req); if err != nil { return zero, err }
	defer httpResp.Body.Close()
	if httpResp.StatusCode < 200 || httpResp.StatusCode > 299 { return zero, fmt.Errorf("terminal http %d", httpResp.StatusCode) }
	var resp Response[T]; if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil { return zero, err }
	if resp.Code != CodeSuccess { return resp, &Error{Code: resp.Code, Message: resp.Message} }
	return resp, nil
}

func (c *Client) ensureKeys(ctx context.Context) error { if _, _, ok := c.keys.Keys(); ok { return nil }; return c.SignIn(ctx) }
func (c *Client) encryptedPassword(ctx context.Context) (string, error) {
	if err := c.ensureKeys(ctx); err != nil { return "", err }
	_, pub, ok := c.keys.Keys(); if !ok { return "", fmt.Errorf("missing platform public key") }
	return EncryptManagerPassword(c.opt.ManagerPassword, pub)
}
func amount(cents int64) string { return fmt.Sprintf("%012d", cents) }
func isCode(err error, code int) bool { var e *Error; return errors.As(err, &e) && e.Code == code }
