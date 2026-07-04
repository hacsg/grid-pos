package daemon

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"kpay-daemon/config"
	"kpay-daemon/logx"
)

type wsConn struct {
	net.Conn
	br *bufio.Reader
	mu sync.Mutex
}

func Run(ctx context.Context, cfg config.Config, h *Handler, log *logx.Logger) error {
	wsURL, err := cfg.DaemonWSURL()
	if err != nil {
		return err
	}
	backoff := time.Second
	for ctx.Err() == nil {
		conn, err := dialWS(ctx, wsURL, cfg.DaemonToken)
		if err != nil {
			log.Warn("ws connect failed", "error", err)
			sleep(ctx, backoff)
			backoff = capDur(backoff*2, 15*time.Second)
			continue
		}
		backoff = time.Second
		log.Info("ws connected", "url", wsURL)
		_ = conn.Send(map[string]any{"type": "hello", "outlet_id": cfg.OutletID, "terminal_ip": cfg.TerminalIP, "daemon_version": "1.0.0"})
		errc := make(chan error, 2)
		cctx, cancel := context.WithCancel(ctx)
		go heartbeat(cctx, conn, errc)
		go readLoop(cctx, conn, h, errc)
		err = <-errc
		cancel()
		_ = conn.Close()
		if ctx.Err() == nil {
			log.Warn("ws disconnected", "error", err)
			sleep(ctx, backoff)
			backoff = capDur(backoff*2, 15*time.Second)
		}
	}
	return ctx.Err()
}

func readLoop(ctx context.Context, c *wsConn, h *Handler, errc chan<- error) {
	for ctx.Err() == nil {
		raw, err := c.ReadMessage()
		if err != nil {
			errc <- err
			return
		}
		go h.HandleWS(ctx, c, raw)
	}
}

func heartbeat(ctx context.Context, c *wsConn, errc chan<- error) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := c.Send(map[string]string{"type": "ping"}); err != nil {
				errc <- err
				return
			}
		}
	}
}

func dialWS(ctx context.Context, rawurl string, token string) (*wsConn, error) {
	u, err := url.Parse(rawurl)
	if err != nil {
		return nil, err
	}
	// Bound the whole dial (TCP + TLS + upgrade response). Without this a
	// stalled handshake hangs Run() forever with nothing in the log — the
	// retry/backoff loop never gets a chance.
	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	host := u.Host
	dialer := net.Dialer{}
	conn, err := dialer.DialContext(dialCtx, "tcp", addrFor(u))
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	if u.Scheme == "wss" {
		tc := tls.Client(conn, &tls.Config{ServerName: strings.Split(host, ":")[0], MinVersion: tls.VersionTLS12})
		if err := tc.HandshakeContext(dialCtx); err != nil {
			_ = conn.Close()
			return nil, err
		}
		conn = tc
	}
	keyBytes := make([]byte, 16)
	_, _ = rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)
	path := u.RequestURI()
	if path == "" {
		path = "/"
	}
	authToken := strings.NewReplacer("\r", "", "\n", "").Replace(strings.TrimSpace(token))
	req := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer %s\r\n\r\n", path, host, key, authToken)
	if _, err := io.WriteString(conn, req); err != nil {
		_ = conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, &http.Request{Method: "GET"})
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols || resp.Header.Get("Sec-WebSocket-Accept") != acceptKey(key) {
		_ = conn.Close()
		return nil, fmt.Errorf("bad websocket handshake: %s", resp.Status)
	}
	_ = conn.SetDeadline(time.Time{})
	return &wsConn{Conn: conn, br: br}, nil
}

func (c *wsConn) Send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.writeFrame(1, b)
}

func (c *wsConn) ReadMessage() ([]byte, error) {
	for {
		op, p, err := c.readFrame()
		if err != nil {
			return nil, err
		}
		switch op {
		case 1, 2:
			return p, nil
		case 8:
			return nil, io.EOF
		case 9:
			_ = c.writeFrame(10, p)
		}
	}
}

func (c *wsConn) readFrame() (byte, []byte, error) {
	h := make([]byte, 2)
	if _, err := io.ReadFull(c.br, h); err != nil {
		return 0, nil, err
	}
	if h[0]&0x80 == 0 {
		return 0, nil, fmt.Errorf("fragmented websocket frames unsupported")
	}
	op, ln := h[0]&0x0f, uint64(h[1]&0x7f)
	if ln == 126 {
		var b [2]byte
		_, _ = io.ReadFull(c.br, b[:])
		ln = uint64(binary.BigEndian.Uint16(b[:]))
	} else if ln == 127 {
		var b [8]byte
		_, _ = io.ReadFull(c.br, b[:])
		ln = binary.BigEndian.Uint64(b[:])
	}
	var mask [4]byte
	masked := h[1]&0x80 != 0
	if masked {
		_, _ = io.ReadFull(c.br, mask[:])
	}
	p := make([]byte, ln)
	if _, err := io.ReadFull(c.br, p); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range p {
			p[i] ^= mask[i%4]
		}
	}
	return op, p, nil
}

func (c *wsConn) writeFrame(op byte, p []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var h []byte
	if len(p) < 126 {
		h = []byte{0x80 | op, 0x80 | byte(len(p))}
	} else if len(p) <= 65535 {
		h = make([]byte, 4)
		h[0], h[1] = 0x80|op, 0x80|126
		binary.BigEndian.PutUint16(h[2:], uint16(len(p)))
	} else {
		h = make([]byte, 10)
		h[0], h[1] = 0x80|op, 0x80|127
		binary.BigEndian.PutUint64(h[2:], uint64(len(p)))
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	out := append(append(h, mask...), p...)
	for i := range p {
		out[len(h)+4+i] ^= mask[i%4]
	}
	_, err := c.Conn.Write(out)
	return err
}

func acceptKey(key string) string {
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func addrFor(u *url.URL) string {
	if strings.Contains(u.Host, ":") {
		return u.Host
	}
	if u.Scheme == "wss" {
		return u.Host + ":443"
	}
	return u.Host + ":80"
}

// capDur returns the smaller of a and b. It replaces the Go 1.21 min builtin
// so the daemon builds with Go 1.20 (the last Windows 7-compatible release).
func capDur(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
