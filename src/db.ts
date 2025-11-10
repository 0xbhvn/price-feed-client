import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

const pool = new Pool(
  connectionString
    ? {
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      }
    : {
        host: process.env.DB_HOST || process.env.PGHOST || "localhost",
        port: parseInt(process.env.DB_PORT || process.env.PGPORT || "5432"),
        database: process.env.DB_NAME || process.env.PGDATABASE || "trades",
        user: process.env.DB_USER || process.env.PGUSER || "postgres",
        password:
          process.env.DB_PASSWORD || process.env.PGPASSWORD || "postgres",
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      },
);

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err);
});

pool.on('connect', () => {
  console.log('[DB] New client connected to pool');
});

pool.on('remove', () => {
  console.log('[DB] Client removed from pool');
});

export interface Trade {
  symbol: string;
  price: string;
  quantity: string;
  timestamp: number;
  is_buyer_maker: boolean;
  trade_id: string;
}

export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        price DECIMAL(20, 8) NOT NULL,
        quantity DECIMAL(20, 8) NOT NULL,
        timestamp BIGINT NOT NULL,
        is_buyer_maker BOOLEAN NOT NULL,
        trade_id VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
    `);
    console.log("[DB] Initialized successfully");
  } finally {
    client.release();
  }
}

export async function insertTrade(trade: Trade): Promise<void> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await pool.query(
        `INSERT INTO trades (symbol, price, quantity, timestamp, is_buyer_maker, trade_id) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         ON CONFLICT (trade_id) DO NOTHING`,
        [
          trade.symbol,
          trade.price,
          trade.quantity,
          trade.timestamp,
          trade.is_buyer_maker,
          trade.trade_id,
        ],
      );
      return;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        console.warn(`[DB] Insert attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      }
    }
  }

  throw new Error(`Failed to insert trade after ${maxRetries} attempts: ${lastError?.message}`);
}

export async function deleteOldTrades(minutesOld: number = 5): Promise<number> {
  const result = await pool.query(
    `DELETE FROM trades 
     WHERE created_at < NOW() - INTERVAL '1 minute' * $1`,
    [minutesOld],
  );
  return result.rowCount || 0;
}

export async function deleteOldUniquePrices(
  minutesOld: number = 5,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM unique_prices 
     WHERE created_at < NOW() - INTERVAL '1 minute' * $1`,
    [minutesOld],
  );
  return result.rowCount || 0;
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export function getPool() {
  return pool;
}

export async function updatePriceTransactionHash(
  symbol: string,
  windowStart: Date,
  transactionHash: string
): Promise<void> {
  await pool.query(
    `UPDATE unique_prices 
     SET transaction_hash = $1 
     WHERE symbol = $2 AND window_start = $3 AND transaction_hash IS NULL`,
    [transactionHash, symbol, windowStart]
  );
}

export interface UniquePriceWindow {
  symbol: string;
  prices: string[];
  window_start: Date;
  window_end: Date;
}

export async function initUniquePricesDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS unique_prices (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        price DECIMAL(20, 8) NOT NULL,
        window_start TIMESTAMP NOT NULL,
        window_end TIMESTAMP NOT NULL,
        transaction_hash VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_unique_prices_symbol ON unique_prices(symbol);
      CREATE INDEX IF NOT EXISTS idx_unique_prices_window_start ON unique_prices(window_start);
      CREATE INDEX IF NOT EXISTS idx_unique_prices_created_at ON unique_prices(created_at);
      CREATE INDEX IF NOT EXISTS idx_unique_prices_transaction_hash ON unique_prices(transaction_hash);
    `);
    console.log("[DB] Unique prices table initialized successfully");
  } finally {
    client.release();
  }
}

export async function getUniquePricesInWindow(
  symbol: string,
  startTimestamp: number,
  endTimestamp: number,
): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT price 
     FROM trades 
     WHERE symbol = $1 
       AND timestamp >= $2 
       AND timestamp < $3
     ORDER BY price`,
    [symbol, startTimestamp, endTimestamp],
  );
  return result.rows.map((row) => row.price);
}

export async function insertUniquePriceWindow(
  symbol: string,
  prices: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<void> {
  if (prices.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const price of prices) {
      await client.query(
        `INSERT INTO unique_prices (symbol, price, window_start, window_end) 
         VALUES ($1, $2, $3, $4)`,
        [symbol, price, windowStart, windowEnd],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
