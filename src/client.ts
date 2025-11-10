import WebSocket from "ws";
import { insertTrade, type Trade } from "./db.js";

interface BinanceTrade {
  e: string;
  E: number;
  s: string;
  t: number;
  p: string;
  q: string;
  b: number;
  a: number;
  T: number;
  m: boolean;
  M: boolean;
}

export class PriceFeedClient {
  private ws: WebSocket | null = null;
  private reconnectInterval = 5000;
  private readonly symbol: string;
  private readonly wsUrl: string;
  private shouldReconnect = true;
  private onTradeCallback?: (trade: Trade) => void;

  constructor(
    symbol: string = "xlmusdt",
    onTradeCallback?: (trade: Trade) => void,
  ) {
    this.symbol = symbol.toLowerCase();
    this.wsUrl = `wss://stream.binance.com:9443/ws/${this.symbol}@trade`;
    this.onTradeCallback = onTradeCallback;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }

  private connect(): void {
    console.log(`[WS] Connecting to ${this.symbol.toUpperCase()}...`);

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", () => {
      console.log(`[WS] Connected to ${this.symbol.toUpperCase()} stream`);
    });

    this.ws.on("message", async (data: WebSocket.Data) => {
      try {
        const trade = JSON.parse(data.toString()) as BinanceTrade;

        if (trade.e === "trade") {
          const tradeData: Trade = {
            symbol: trade.s,
            price: trade.p,
            quantity: trade.q,
            timestamp: trade.T,
            is_buyer_maker: trade.m,
            trade_id: `${trade.s}-${trade.t}`,
          };

          await insertTrade(tradeData);
          console.log(
            `[TRADE] ${tradeData.symbol} ${tradeData.price} x ${tradeData.quantity}`,
          );

          if (this.onTradeCallback) {
            this.onTradeCallback(tradeData);
          }
        }
      } catch (error) {
        console.error("[WS] Failed to process trade:", error);
      }
    });

    this.ws.on("error", (error) => {
      console.error("[WS] Connection error:", error);
    });

    this.ws.on("close", () => {
      if (this.shouldReconnect) {
        console.log(
          `[WS] Disconnected, reconnecting in ${this.reconnectInterval / 1000}s...`,
        );
        setTimeout(() => this.connect(), this.reconnectInterval);
      } else {
        console.log("[WS] Connection closed");
      }
    });
  }
}
