import cron from "node-cron";
import { Networks } from "@stellar/stellar-sdk";
import { PriceFeedClient } from "./client.js";
import {
  initDatabase,
  closeDatabase,
  deleteOldTrades,
  deleteOldUniquePrices,
  initUniquePricesDatabase,
  getUniquePricesInWindow,
  insertUniquePriceWindow,
  getPool,
  updatePriceTransactionHash,
} from "./db.js";
import { OracleUpdater } from "./oracle.js";

async function main() {
  try {
    console.log("[MAIN] Starting Price Feed Client");

    await initDatabase();
    await initUniquePricesDatabase();

    const symbol = process.env.SYMBOL || "xlmusdt";
    const client = new PriceFeedClient(symbol);
    client.start();

    // Start oracle updater if configured
    const oracleRpcUrl = process.env.STELLAR_RPC_URL;
    const oracleContractId = process.env.ORACLE_CONTRACT_ID;
    const oracleAdminSecret = process.env.ORACLE_ADMIN_SECRET;
    const stellarNetwork = process.env.STELLAR_NETWORK || "testnet";

    if (oracleRpcUrl && oracleContractId && oracleAdminSecret) {
      const networkPassphrase =
        stellarNetwork === "public" ? Networks.PUBLIC : Networks.TESTNET;
      const oracleUpdater = new OracleUpdater(
        getPool(),
        oracleRpcUrl,
        oracleContractId,
        oracleAdminSecret,
        networkPassphrase,
      );
      oracleUpdater.start();
    } else {
      console.log("[ORACLE] Disabled (missing configuration)");
    }

    cron.schedule("*/5 * * * *", async () => {
      try {
        const deletedTradesCount = await deleteOldTrades(5);
        const deletedUniquePricesCount = await deleteOldUniquePrices(5);

        if (deletedTradesCount > 0 || deletedUniquePricesCount > 0) {
          console.log(
            `[CRON] Cleaned up ${deletedTradesCount} trade(s), ${deletedUniquePricesCount} price record(s)`,
          );
        }
      } catch (error) {
        console.error("[CRON] Failed to clean up old data:", error);
      }
    });
    console.log("[CRON] Scheduled cleanup job (every 5 minutes)");

    cron.schedule("*/10 * * * * *", async () => {
      try {
        const now = Date.now();
        const windowEnd = now;
        const windowStart = now - 10000;

        const uniquePrices = await getUniquePricesInWindow(
          symbol.toUpperCase(),
          windowStart,
          windowEnd,
        );

        if (uniquePrices.length > 0) {
          await insertUniquePriceWindow(
            symbol.toUpperCase(),
            uniquePrices,
            new Date(windowStart),
            new Date(windowEnd),
          );
          console.log(
            `[CRON] Aggregated ${uniquePrices.length} unique price(s) for window ${new Date(windowStart).toISOString()}`,
          );
        }
      } catch (error) {
        console.error("[CRON] Failed to aggregate unique prices:", error);
      }
    });
    console.log("[CRON] Scheduled price aggregation (every 10 seconds)");

    process.on("SIGINT", async () => {
      console.log("\n[MAIN] Shutting down...");
      client.stop();
      await closeDatabase();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n[MAIN] Shutting down...");
      client.stop();
      await closeDatabase();
      process.exit(0);
    });
  } catch (error) {
    console.error("[MAIN] Failed to start:", error);
    process.exit(1);
  }
}

main();
