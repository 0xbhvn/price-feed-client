# Price Feed Trade Client

A TypeScript service that connects to Price Feed WebSocket and stores real-time trades in PostgreSQL. Includes automatic cleanup of trades older than 5 minutes via cron job.

## Features

- Real-time trade streaming from Price Feed WebSocket
- Automatic PostgreSQL storage with deduplication
- Auto-reconnection on connection loss
- **Automated cleanup**: Cron job runs every 5 minutes to delete trades older than 5 minutes
- Graceful shutdown handling

---

## Local Development

### Prerequisites

- Node.js 18+
- Docker & Docker Compose

### Setup

1. Start PostgreSQL (using Docker):

```bash
docker-compose up -d
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables (already created with defaults):

```bash
# .env is already configured for local Docker PostgreSQL
# Edit if you need to change database settings
```

4. Build and start the service:

```bash
npm run build
npm start
```

### Managing PostgreSQL

```bash
# Stop database
docker-compose down

# Stop and remove data
docker-compose down -v

# View database logs
docker-compose logs -f postgres

# Connect to database
docker exec -it trades-postgres psql -U postgres -d trades

# Query trades
docker exec trades-postgres psql -U postgres -d trades -c "SELECT * FROM trades ORDER BY created_at DESC LIMIT 10;"
```

---

## Production Deployment (Railway)

### Prerequisites

- Railway account ([railway.app](https://railway.app))
- Railway CLI installed (optional)

### Option 1: Deploy via Railway Dashboard

1. **Create a new project** on Railway

2. **Add PostgreSQL database**:
   - Click "New" → "Database" → "Add PostgreSQL"
   - Railway will automatically create the database and provide connection variables

3. **Add the service**:
   - Click "New" → "GitHub Repo" (or "Empty Service")
   - Connect your repository and select the `backend` directory
   - Railway will auto-detect the `railway.toml` configuration

4. **Configure environment variables**:
   Go to your service settings and add:

   ```
   SYMBOL=xlmusdt
   ```

   **Note**: Database connection variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) are automatically provided by Railway PostgreSQL and detected by the service. No manual mapping needed!

5. **Deploy**:
   - Railway will automatically build and deploy
   - Monitor logs to ensure successful connection

### Option 2: Deploy via Railway CLI

```bash
# Login to Railway
railway login

# Initialize project (in backend directory)
cd backend
railway init

# Link to PostgreSQL
railway add --database postgres

# Set environment variables
railway variables set SYMBOL=xlmusdt

# Deploy
railway up
```

### Railway Environment Variables

The service automatically detects Railway's PostgreSQL environment variables:

| Railway Variable | Alternative | Description | Required |
|------------------|-------------|-------------|----------|
| `PGHOST` | `DB_HOST` | PostgreSQL host | Auto-provided |
| `PGPORT` | `DB_PORT` | PostgreSQL port | Auto-provided |
| `PGDATABASE` | `DB_NAME` | Database name | Auto-provided |
| `PGUSER` | `DB_USER` | Database user | Auto-provided |
| `PGPASSWORD` | `DB_PASSWORD` | Database password | Auto-provided |
| `SYMBOL` | - | Trading pair to monitor | **Yes** (e.g., `xlmusdt`) |

**Note**: The service supports both `PG*` (Railway standard) and `DB_*` (custom) variable formats automatically.

### Monitoring on Railway

- **View logs**: Railway Dashboard → Your Service → Logs
- **Check metrics**: Railway Dashboard → Your Service → Metrics
- **Database queries**: Railway Dashboard → PostgreSQL → Query

---

## Configuration

### Environment Variables

| Variable | Description | Local Default | Production |
|----------|-------------|---------------|------------|
| `DB_HOST` | PostgreSQL host | `localhost` | From Railway |
| `DB_PORT` | PostgreSQL port | `5432` | From Railway |
| `DB_NAME` | Database name | `trades` | From Railway |
| `DB_USER` | Database user | `postgres` | From Railway |
| `DB_PASSWORD` | Database password | `postgres` | From Railway |
| `SYMBOL` | Trading pair | `xlmusdt` | Set manually |

### Supported Trading Pairs

Any spot trading pair (lowercase):

- `btcusdt` - Bitcoin/USDT
- `ethusdt` - Ethereum/USDT
- `xlmusdt` - Stellar/USDT (default)
- `solusdt` - Solana/USDT
- etc.

---

## Database Schema

The service automatically creates a `trades` table with:

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-incrementing primary key |
| `symbol` | VARCHAR(50) | Trading pair symbol |
| `price` | DECIMAL(20,8) | Trade price |
| `quantity` | DECIMAL(20,8) | Trade quantity |
| `timestamp` | BIGINT | Unix timestamp (ms) |
| `is_buyer_maker` | BOOLEAN | Whether buyer is market maker |
| `trade_id` | VARCHAR(100) | Unique trade identifier |
| `created_at` | TIMESTAMP | Record creation timestamp |

**Indexes**: `symbol`, `timestamp`, `created_at`

---

## Development

### Watch Mode

```bash
# Terminal 1: Watch TypeScript compilation
npm run watch

# Terminal 2: Run the service
npm start
```

### Testing Database Connection

```bash
# Local (Docker)
docker exec trades-postgres psql -U postgres -d trades -c "SELECT version();"

# Railway (use Railway CLI)
railway run psql
```

---

## Troubleshooting

### Local Development

**PostgreSQL not starting:**

```bash
docker-compose down -v
docker-compose up -d
docker-compose logs postgres
```

**Connection refused:**

- Ensure PostgreSQL container is running: `docker ps`
- Check `.env` file has correct credentials
- Verify port 5432 is not in use: `lsof -i :5432`

### Railway Deployment

**Database connection errors:**

- Verify PostgreSQL service is linked to your app
- Check environment variables are properly set
- Review Railway logs for connection details

**Build failures:**

- Ensure `railway.toml` is in the backend directory
- Verify `package.json` has correct build scripts
- Check Railway build logs for specific errors

**Service crashes on startup:**

- Check Railway logs for error messages
- Verify `SYMBOL` environment variable is set
- Ensure database migrations completed successfully

---

## License

See main project LICENSE
