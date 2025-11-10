import cron from 'node-cron';
import { PriceFeedClient } from './client.js';
import { 
	initDatabase, 
	closeDatabase, 
	deleteOldTrades,
	deleteOldUniquePrices,
	initUniquePricesDatabase,
	getUniquePricesInWindow,
	insertUniquePriceWindow
} from './db.js';

async function main() {
	try {
		console.log('[MAIN] Starting Price Feed Client');

		await initDatabase();
		await initUniquePricesDatabase();

		const symbol = process.env.SYMBOL || 'xlmusdt';
		const client = new PriceFeedClient(symbol);
		client.start();

		cron.schedule('*/5 * * * *', async () => {
			try {
				const deletedTradesCount = await deleteOldTrades(5);
				const deletedUniquePricesCount = await deleteOldUniquePrices(5);
				
				if (deletedTradesCount > 0 || deletedUniquePricesCount > 0) {
					console.log(
						`[CRON] Cleaned up ${deletedTradesCount} old trade(s) and ${deletedUniquePricesCount} unique price record(s)`
					);
				}
			} catch (error) {
				console.error('[CRON] Failed to clean up old data:', error);
			}
		});
		console.log('[CRON] Scheduled cleanup job (every 5 minutes)');

		cron.schedule('*/10 * * * * *', async () => {
			try {
				const now = Date.now();
				const windowEnd = now;
				const windowStart = now - 10000;

				const uniquePrices = await getUniquePricesInWindow(
					symbol.toUpperCase(),
					windowStart,
					windowEnd
				);

				if (uniquePrices.length > 0) {
					await insertUniquePriceWindow(
						symbol.toUpperCase(),
						uniquePrices,
						new Date(windowStart),
						new Date(windowEnd)
					);
					console.log(
						`[CRON-UNIQUE] Window ${new Date(windowStart).toISOString()} - ${new Date(windowEnd).toISOString()}: ${uniquePrices.length} unique price(s)`
					);
				}
			} catch (error) {
				console.error('[CRON-UNIQUE] Failed to track unique prices:', error);
			}
		});
		console.log('[CRON] Scheduled unique price tracking job (every 10 seconds)');

		process.on('SIGINT', async () => {
			console.log('\n[MAIN] Shutting down...');
			client.stop();
			await closeDatabase();
			process.exit(0);
		});

		process.on('SIGTERM', async () => {
			console.log('\n[MAIN] Shutting down...');
			client.stop();
			await closeDatabase();
			process.exit(0);
		});
	} catch (error) {
		console.error('[MAIN] Failed to start:', error);
		process.exit(1);
	}
}

main();
