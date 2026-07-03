# Android POS — UI Prototype Only (Deprecated)

**This directory is not the production POS.** The active client is [`pos-web/`](../pos-web/).

## Status

- **UI prototype only** — not wired to the Grid POS FastAPI backend
- Does **not** create backend orders
- Uses local Room DB with hardcoded sample data
- Payment flow targets Stripe/KPay endpoints that do not exist on the current backend
- On success, prints a **test receipt**, not a real order receipt

## Do not deploy

Do not ship debug or release builds of this app for live checkout. Use `pos-web` for production POS operations.