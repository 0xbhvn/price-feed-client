import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432'),
  database: process.env.DB_NAME || process.env.PGDATABASE || 'trades',
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
    console.log('[DB] Initialized successfully');
  } finally {
    client.release();
  }
}

export async function insertTrade(trade: Trade): Promise<void> {
  await pool.query(
    `INSERT INTO trades (symbol, price, quantity, timestamp, is_buyer_maker, trade_id) 
     VALUES ($1, $2, $3, $4, $5, $6) 
     ON CONFLICT (trade_id) DO NOTHING`,
    [trade.symbol, trade.price, trade.quantity, trade.timestamp, trade.is_buyer_maker, trade.trade_id]
  );
}

export async function deleteOldTrades(minutesOld: number = 5): Promise<number> {
  const result = await pool.query(
    `DELETE FROM trades 
     WHERE created_at < NOW() - INTERVAL '1 minute' * $1`,
    [minutesOld]
  );
  return result.rowCount || 0;
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
