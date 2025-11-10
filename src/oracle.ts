import { Pool } from 'pg';
import {
	Contract,
	Keypair,
	Networks,
	TransactionBuilder,
	BASE_FEE,
	nativeToScVal,
	xdr
} from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { updatePriceTransactionHash } from './db.js';

export interface UniquePrice {
	id: number;
	symbol: string;
	price: string;
	window_start: Date;
	window_end: Date;
	created_at: Date;
}

export class OracleUpdater {
	private pool: Pool;
	private lastProcessedId: number = 0;
	private rpcUrl: string;
	private contractId: string;
	private adminKeypair: Keypair;
	private networkPassphrase: string;

	constructor(
		pool: Pool,
		rpcUrl: string,
		contractId: string,
		adminSecretKey: string,
		networkPassphrase: string = Networks.TESTNET
	) {
		this.pool = pool;
		this.rpcUrl = rpcUrl;
		this.contractId = contractId;
		this.adminKeypair = Keypair.fromSecret(adminSecretKey);
		this.networkPassphrase = networkPassphrase;
	}

	async start(): Promise<void> {
		console.log('[ORACLE] Started (polling every 10 seconds)');
		await this.loadLastProcessedId();
		
		setInterval(() => {
			this.checkAndUpdate().catch((error) => {
				console.error('[ORACLE] Failed to check/update:', error);
			});
		}, 10000); // 10 seconds
	}

	private async loadLastProcessedId(): Promise<void> {
		try {
			const result = await this.pool.query(
				'SELECT MAX(id) as max_id FROM unique_prices'
			);
			this.lastProcessedId = result.rows[0]?.max_id || 0;
			console.log(`[ORACLE] Resuming from ID ${this.lastProcessedId}`);
		} catch (error) {
			console.error('[ORACLE] Failed to load last ID:', error);
		}
	}

	private async checkAndUpdate(): Promise<void> {
		try {
			const result = await this.pool.query<UniquePrice>(
				`SELECT id, symbol, price, window_start, window_end, created_at 
         FROM unique_prices 
         WHERE id > $1 
         ORDER BY window_start ASC, id ASC 
         LIMIT 100`,
				[this.lastProcessedId]
			);

			if (result.rows.length === 0) {
				return;
			}

			// Group prices by (symbol, window_start)
			const pricesByWindow = new Map<string, { 
				symbol: string; 
				prices: string[]; 
				window_start: Date;
				maxId: number;
			}>();

			for (const row of result.rows) {
				const key = `${row.symbol}-${row.window_start.getTime()}`;
				
				if (!pricesByWindow.has(key)) {
					pricesByWindow.set(key, {
						symbol: row.symbol,
						prices: [],
						window_start: row.window_start,
						maxId: row.id
					});
				}
				
				const group = pricesByWindow.get(key)!;
				group.prices.push(row.price);
				group.maxId = Math.max(group.maxId, row.id);
			}

			console.log(`[ORACLE] Found ${pricesByWindow.size} window(s) with ${result.rows.length} total price(s)`);

			// Update contract for each window (serially to avoid sequence number collisions)
			for (const [key, data] of pricesByWindow) {
				const success = await this.updateContract(data.symbol, data.prices, data.window_start);
				if (success) {
					this.lastProcessedId = data.maxId;
				} else {
					console.warn(`[ORACLE] Skipping remaining windows due to failure`);
					break;
				}
			}
		} catch (error) {
			console.error('[ORACLE] Error in checkAndUpdate:', error);
		}
	}

	private async updateContract(
		symbol: string, 
		prices: string[], 
		windowStart: Date
	): Promise<boolean> {
		try {
			const server = new Server(this.rpcUrl);
			const sourceAccount = await server.getAccount(this.adminKeypair.publicKey());

			// Convert all prices to i128 (8 decimal places)
			const pricesAsI128 = prices.map(price => {
				const priceAsNumber = parseFloat(price);
				return nativeToScVal(Math.round(priceAsNumber * 100000000), { type: 'i128' });
			});

			// Convert window_start timestamp to seconds (Unix timestamp)
			const windowTimestamp = Math.floor(windowStart.getTime() / 1000);

			const contract = new Contract(this.contractId);
			
			// Build the transaction
			const transaction = new TransactionBuilder(sourceAccount, {
				fee: BASE_FEE,
				networkPassphrase: this.networkPassphrase,
			})
				.addOperation(
					contract.call(
						'update_prices',
						nativeToScVal(symbol.toUpperCase().slice(0, 10), { type: 'symbol' }),
						xdr.ScVal.scvVec(pricesAsI128),
						nativeToScVal(windowTimestamp, { type: 'u64' })
					)
				)
				.setTimeout(30)
				.build();

			// Simulate first
			const simulatedTx = await server.simulateTransaction(transaction);
			
			if ('error' in simulatedTx) {
				console.error('[ORACLE] Simulation error:', (simulatedTx as any).error);
				return false;
			}

			// Prepare and sign
			const preparedTx = await server.prepareTransaction(transaction);
			preparedTx.sign(this.adminKeypair);

			// Submit
			const sendResponse = await server.sendTransaction(preparedTx);
			const txHash = sendResponse.hash;
			
			console.log(`[ORACLE] Submitted transaction: ${txHash}`);
			
			if (sendResponse.status === 'PENDING') {
				// Wait for confirmation (increased timeout for sequence number reliability)
				let getResponse = await server.getTransaction(txHash);
				let attempts = 0;
				
				while (getResponse.status === 'NOT_FOUND' && attempts < 30) {
					await new Promise(resolve => setTimeout(resolve, 1000));
					getResponse = await server.getTransaction(txHash);
					attempts++;
				}

				if (getResponse.status === 'SUCCESS') {
					console.log(`[ORACLE] ✅ TX ${txHash}: ${symbol} window=${windowTimestamp} with ${prices.length} price(s): [${prices.join(', ')}]`);
					
					// Update database with transaction hash
					try {
						await updatePriceTransactionHash(symbol, windowStart, txHash);
					} catch (dbError) {
						console.error(`[ORACLE] Failed to save TX hash to database:`, dbError);
					}
					
					return true;
				} else {
					console.error(`[ORACLE] ❌ TX ${txHash} failed:`, getResponse);
					return false;
				}
			} else {
				console.error(`[ORACLE] ❌ TX ${txHash} rejected immediately:`, sendResponse);
				return false;
			}
			
			return false;
		} catch (error) {
			console.error(`[ORACLE] Error updating contract for ${symbol}:`, error);
			return false;
		}
	}
}
