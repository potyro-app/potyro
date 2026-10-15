# Ticker

A watchlist of live prices — crypto as it trades on Coinbase, currencies at the ECB's reference rate —
with the change, a sparkline of the last hour, a chart per symbol, and alerts that ring once when a
price crosses a line you set.

```
ticker.app.ts   the app: Watchlist, Alerts, a symbol's page with its chart
feed.ts         the live side: ticks coalesced into writes, a point a minute, the ECB's rates, alerts, the demo
prices.ts       Coinbase's and Frankfurter's answers read; the coalescer; change, sparkline, alerts, pruning
live.ts         keeping one live connection (shared by the live apps)
words.ts        how a price and the feed read, in six languages
fixtures/       real answers: Coinbase's ticker messages and candles, Frankfurter's latest and a month
test/           reading, coalescing, the prices end to end against a scripted ctx
```

## How it works

- **Crypto** is Coinbase Exchange's public WebSocket, `wss://ws-feed.exchange.coinbase.com` (docs/28):
  `{"type":"subscribe","product_ids":[…],"channels":["ticker"]}`, said again on every reconnect; then a
  `ticker` message per trade. A symbol added or removed while live is subscribed or unsubscribed at once.
  **Watch live** first fills the last hour in from Coinbase's 1-minute candles.
- **Currencies**: there is no public, keyless WebSocket for exchange rates, so they are **fetched** — the
  ECB's reference rates through Frankfurter (`api.frankfurter.dev`), with a month behind them for the
  sparkline, again every 30 minutes while live. They change once a working day; the app says so, and
  shows the ECB's day beside each rate.
- **Coalescing** (prices.ts `Coalescer`): ticks are only remembered — the newest per symbol — and a
  symbol's price is written at most every 3 s. A hundred ticks a second become one write per symbol
  every three seconds (an e2e test counts what the list shows). One point a minute per symbol, an hour
  of them kept.
- **Change**: crypto against Coinbase's 24-hour open, a currency against the working day before.
- **Alerts**: a line above, a line below, per symbol. A crossing rings once (a notification on a
  phone, words on screen on the web), is listed under Alerts, and the line is cleared.
- **The demo**: an hour of made-up history, then a made-up market ticking eight times a second through
  the same reading and coalescing, nothing sent. **Watch live** takes the made-up history away.

## Sealed and yours

Built-in views only. Sealed it reaches `ws-feed.exchange.coinbase.com`, `api.exchange.coinbase.com` and
`api.frankfurter.dev` only; asked once before the network and once before the live connection.

## Build and check

```
pnpm --filter @potyro/app-ticker build           # → apps/ticker/dist/ticker.potyro-app.zip
pnpm --filter @potyro/app-ticker test
pnpm e2e e2e/ticker-trusted.spec.ts
```
