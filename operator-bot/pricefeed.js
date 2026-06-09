// Real BTC/USD price feed for the operator bot.
// ---------------------------------------------
// Live ticks come from an exchange WebSocket; a REST endpoint is used to seed the first price
// and as a fallback whenever the socket is stale/disconnected. Based on the FE's Binance @trade
// approach (components/.../useAssetPriceFeed.ts), generalized to a few providers because Binance's
// global endpoint is geo-blocked (HTTP 451) from some server locations (e.g. the US).
//
// Provider is chosen via PRICE_SOURCE env: 'binance' (default), 'binanceus', or 'coinbase'.

import WebSocket from 'ws'

const ASSET = (process.env.ASSET || 'BTC').toUpperCase()

const SOURCES = {
  // Binance global — matches the FE; use on a non-US server.
  binance: {
    kind: 'binance',
    ws: `wss://stream.binance.com:9443/ws/${ASSET.toLowerCase()}usdt@trade`,
    rest: `https://api.binance.com/api/v3/ticker/price?symbol=${ASSET}USDT`,
  },
  // Binance US — same @trade protocol, reachable from the US.
  binanceus: {
    kind: 'binance',
    ws: `wss://stream.binance.us:9443/ws/${ASSET.toLowerCase()}usdt@trade`,
    rest: `https://api.binance.us/api/v3/ticker/price?symbol=${ASSET}USDT`,
  },
  // Coinbase — real BTC-USD, reachable from the US. Different WS protocol (needs a subscribe msg).
  coinbase: {
    kind: 'coinbase',
    ws: 'wss://ws-feed.exchange.coinbase.com',
    rest: `https://api.exchange.coinbase.com/products/${ASSET}-USD/ticker`,
    product: `${ASSET}-USD`,
  },
}

export class PriceFeed {
  constructor(sourceKey = process.env.PRICE_SOURCE || 'binance') {
    this.key = sourceKey
    this.src = SOURCES[sourceKey]
    if (!this.src) throw new Error(`unknown PRICE_SOURCE "${sourceKey}" (use binance | binanceus | coinbase)`)
    this.asset = ASSET
    this.latestPrice = null
    this.latestTs = 0 // ms
    this.ws = null
    this.closed = false
  }

  // Open the live tick stream with auto-reconnect.
  connect() {
    if (this.closed) return
    const ws = new WebSocket(this.src.ws)
    this.ws = ws

    ws.on('open', () => {
      if (this.src.kind === 'coinbase') {
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: [this.src.product], channels: ['ticker'] }))
      }
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (this.src.kind === 'binance') {
          // { p: tradePrice, T: tradeTimeMs }
          const p = parseFloat(msg.p)
          if (Number.isFinite(p)) this._set(p, Number(msg.T) || Date.now())
        } else if (this.src.kind === 'coinbase') {
          if (msg.type === 'ticker' && msg.price) {
            const p = parseFloat(msg.price)
            if (Number.isFinite(p)) this._set(p, msg.time ? Date.parse(msg.time) : Date.now())
          }
        }
      } catch {
        /* skip malformed frame */
      }
    })

    const reconnect = () => {
      if (this.closed) return
      try { ws.removeAllListeners() } catch {}
      setTimeout(() => this.connect(), 1500)
    }
    ws.on('close', reconnect)
    ws.on('error', () => { try { ws.close() } catch {} })
  }

  _set(price, tsMs) {
    this.latestPrice = price
    this.latestTs = tsMs
  }

  // REST spot price (seed + fallback when the socket is stale).
  async restPrice() {
    const r = await fetch(this.src.rest, { headers: { 'User-Agent': 'pricebetgame-operator' } })
    if (!r.ok) throw new Error(`REST ${this.key} HTTP ${r.status}`)
    const j = await r.json()
    const p = parseFloat(j.price) // both binance ticker/price and coinbase ticker expose `price`
    if (!Number.isFinite(p)) throw new Error(`REST ${this.key} bad price`)
    this._set(p, Date.now())
    return p
  }

  // Best current price: fresh socket tick if we have one, else a REST fetch.
  async getPrice({ maxStaleMs = 8000 } = {}) {
    if (this.latestPrice != null && Date.now() - this.latestTs <= maxStaleMs) return this.latestPrice
    try {
      return await this.restPrice()
    } catch (e) {
      // last resort: return whatever we last saw (may be slightly stale) or null
      return this.latestPrice
    }
  }

  async seed() {
    try { return await this.restPrice() } catch { return null }
  }

  close() {
    this.closed = true
    try { this.ws?.close() } catch {}
  }
}
