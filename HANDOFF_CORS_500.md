# Task: a 500 must reach the browser as an error, not as a network failure

## The problem

When a request to the backend raises an unhandled exception, staff at the till
see the toast **"Network Error"**. That is not what happened — the server
answered, with a 500. The browser threw the response away before the client
could read it.

This cost real money today. Twice, a cashier read "Network Error", concluded the
till had lost signal, and tapped Pay again. Each retry committed another order
row, leaving three duplicate pending orders for one $18.50 sale. A cashier who
had been told "the server rejected this" would have stopped.

## Why it happens

`backend/app/main.py` registers `CORSMiddleware`. Starlette wraps the whole
application in `ServerErrorMiddleware`, which is **always the outermost layer**,
outside any user middleware. An unhandled exception is therefore caught above
`CORSMiddleware`, and the plain 500 it returns never passes back down through
the CORS layer. With no `access-control-allow-origin` header, the browser blocks
the response. axios sees no `response` at all and falls through its message
chain to `error.message`, which is the literal string `"Network Error"`
(`pos-web/src/api/client.ts:244`).

Verified: a 200 carries `access-control-allow-origin`; the 500 carries `None`.

## What to build

Catch unhandled exceptions **inside** the CORS layer, and return a JSON response
from there, so it travels back out through `CORSMiddleware` and picks up the
headers.

### Middleware ordering — read this carefully, it is easy to get backwards

Starlette's `add_middleware` **inserts at position 0**, so the middleware added
*last* ends up *outermost*. For the new handler to sit **inside** CORS, its
`add_middleware` call must appear **before** the `CORSMiddleware` call in
`main.py`.

Getting this backwards produces a handler that runs outside CORS, returns a
response with no headers, and looks exactly like the current bug. The test below
is what catches it — do not skip it.

### Response shape

The client reads, in order, `data.detail.detail`, `data.detail`,
`data.message`, then `error.message`. Return a body with a `detail` string so it
lands on the first useful branch:

```json
{"detail": "Something went wrong on our side. Don't retry — this order may already exist. Ref: A7F3C2"}
```

The wording carries the weight. "Network Error" implies *retry*; a server error
means retrying will not help and may duplicate the order. Say so.

`Ref` is a short random token (6 hex chars is fine). Log it with the traceback
via the existing `logging` setup so a reported code can be grepped straight to
the stack trace. Same value in the body and the log line.

### Constraints

- **Do not change behaviour for handled errors.** `HTTPException` and request
  validation errors are handled by `ExceptionMiddleware` *inside* your layer and
  must keep their current status codes and bodies. Only genuinely unhandled
  exceptions become the 500 above.
- **Do not leak internals.** No exception text, module paths, or stack frames in
  the response body. The `Ref` is the only link between what staff see and what
  is in the logs.
- Re-raising after logging is not acceptable — that hands the exception back to
  `ServerErrorMiddleware` and reproduces the bug.
- Keep the existing `CORSMiddleware` configuration exactly as it is.

## Tests (required)

Add to `backend/tests/`, following the conventions in the existing test files:

1. A route that raises returns **500** *and* the response carries
   `access-control-allow-origin` for an allowed `Origin`. This is the
   regression test — confirm it fails if the middleware is registered on the
   wrong side of CORS.
2. The 500 body contains a `detail` string, and that string does **not** contain
   the original exception message.
3. An `HTTPException` (e.g. a 404) is unchanged — same status, same body.

`fastapi.testclient.TestClient(app, raise_server_exceptions=False)` lets you
assert on a 500 instead of the exception propagating.

## Verifying your work

Run the full backend suite from `backend/`:

```
python3 -m pytest -q
```

It is currently **311 passed, 2 skipped**. Nothing should regress.

Do not touch the frontend. The existing message chain in `client.ts` already
picks up `data.detail` once the response actually reaches it.
