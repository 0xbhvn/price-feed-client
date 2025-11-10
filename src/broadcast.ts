import WebSocket, { WebSocketServer } from "ws";
import type { Trade } from "./db.js";

export class TradeBroadcastServer {
  private wss: WebSocketServer;
  private lastBroadcastSecond: number = 0;
  private lastBroadcastPrice: string = "";
  private clients: Set<WebSocket> = new Set();

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      console.log(
        `[BROADCAST] Client connected (total: ${this.clients.size})`,
      );

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(
          `[BROADCAST] Client disconnected (total: ${this.clients.size})`,
        );
      });

      ws.on("error", (error) => {
        console.error("[BROADCAST] Client error:", error);
        this.clients.delete(ws);
      });
    });

    console.log(`[BROADCAST] WebSocket server listening on port ${port}`);
  }

  shouldBroadcast(trade: Trade): boolean {
    const currentSecond = Math.floor(trade.timestamp / 1000);
    const priceChanged = trade.price !== this.lastBroadcastPrice;
    const secondChanged = currentSecond !== this.lastBroadcastSecond;

    return priceChanged || secondChanged;
  }

  broadcast(trade: Trade): void {
    if (!this.shouldBroadcast(trade)) {
      return;
    }

    const currentSecond = Math.floor(trade.timestamp / 1000);
    this.lastBroadcastSecond = currentSecond;
    this.lastBroadcastPrice = trade.price;

    const message = JSON.stringify({
      timestamp: trade.timestamp,
      price: trade.price,
    });

    let successCount = 0;
    let failCount = 0;

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          successCount++;
        } catch (error) {
          console.error("[BROADCAST] Failed to send to client:", error);
          failCount++;
        }
      }
    });

    if (successCount > 0) {
      console.log(
        `[BROADCAST] Sent to ${successCount} client(s): ${trade.symbol} ${trade.price}`,
      );
    }
  }

  close(): void {
    this.clients.forEach((client) => client.close());
    this.wss.close();
    console.log("[BROADCAST] Server closed");
  }
}
