# KPay Daemon

Go daemon that connects Railway WebSocket payment commands to a KPay POS terminal on the LAN.

Required env is shown in `.env.example`. `KPAT_TERMINAL_IP` may be a bare IP, which maps to `http://<ip>:18080`.

Set `KPAY_LOCAL_TEST=1` to skip Railway and expose `:9000` with `POST /kpay/sales`, `/kpay/query`, `/kpay/cancel`, and `/kpay/refund`.

Build:

```sh
go mod tidy
go build ./...
go vet ./...
```
