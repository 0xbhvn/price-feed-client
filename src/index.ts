import cron from 'node-cron';
import { PriceFeedClient } from './client.js';
import { initDatabase, closeDatabase, deleteOldTrades } from './db.js';

async function main() {
	try {
		console.log('[MAIN] Starting Price Feed Client');

		await initDatabase();

		const symbol = process.env.SYMBOL || 'xlmusdt';
		const client = new PriceFeedClient(symbol);
		client.start();

		cron.schedule('*/5 * * * *', async () => {
			try {
				const deletedCount = await deleteOldTrades(5);
				if (deletedCount > 0) {
					console.log(
						`[CRON] Cleaned up ${deletedCount} old trade(s)`
					);
				}
			} catch (error) {
				console.error('[CRON] Failed to clean up old trades:', error);
			}
		});
		console.log('[CRON] Scheduled cleanup job (every 5 minutes)');

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
