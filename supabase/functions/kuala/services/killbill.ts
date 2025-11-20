import { killBillConfig as getKillBillConfig } from "../../_shared/config/killbill-config.ts";
import {
	KillBillAccount,
	KillBillSubscription,
} from "../../_shared/types/index.ts";
import { logger } from "../middleware/logger.ts";

export class KillBillService {
	private config = getKillBillConfig();
	private baseUrl = this.config.baseUrl.replace(/\/$/, "");
	private credentials = btoa(
		`${this.config.username}:${this.config.password}`,
	);

	/**
	 * Get common headers for Kill Bill API requests
	 */
	private getHeaders(includeAuth = true): Record<string, string> {
		const headers: Record<string, string> = {
			"X-Killbill-ApiKey": this.config.apiKey,
			"X-Killbill-ApiSecret": this.config.apiSecret,
			"X-Killbill-CreatedBy": "kuala-api",
			"Content-Type": "application/json",
			"Accept": "application/json",
		};

		if (includeAuth) {
			headers["Authorization"] = `Basic ${this.credentials}`;
		}

		return headers;
	}

	/**
	 * Get or create Kill Bill account for a user
	 */
	async getOrCreateAccount(
		userId: string,
		email: string,
	): Promise<KillBillAccount> {
		const handlerName = "killbill-service";

		// Try to get existing account by external key
		const existingAccount = await this.getAccountByExternalKey(userId);
		if (existingAccount) {
			logger.info(handlerName, "Found existing Kill Bill account", {
				accountId: existingAccount.accountId,
				externalKey: userId,
			});
			return existingAccount;
		}

		// Create new account if not exists
		return await this.createAccount(userId, email);
	}

	/**
	 * Get account by external key (user ID)
	 */
	async getAccountByExternalKey(
		userId: string,
	): Promise<KillBillAccount | null> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/accounts?externalKey=${
			encodeURIComponent(userId)
		}&accountWithBalance=false&accountWithBalanceAndCBA=false`;

		logger.info(handlerName, "Getting account by external key", {
			url,
			externalKey: userId,
		});

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: this.getHeaders(),
			});

			if (response.ok) {
				const account: KillBillAccount = await response.json();
				return account;
			}

			if (response.status === 404) {
				return null; // Account not found
			}

			logger.error(handlerName, "Failed to get account by external key", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(`Failed to get account: ${response.status}`);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("Failed to get account")
			) {
				throw error;
			}
			logger.warn(handlerName, "Error getting account by external key", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	/**
	 * Create new Kill Bill account
	 */
	async createAccount(
		userId: string,
		email: string,
	): Promise<KillBillAccount> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/accounts`;
		const accountData = {
			name: email,
			email: email,
			externalKey: userId,
			currency: this.config.defaultCurrency,
		};

		logger.info(handlerName, "Creating new Kill Bill account", {
			url,
			externalKey: userId,
		});

		const response = await fetch(url, {
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify(accountData),
		});

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(handlerName, "Failed to create Kill Bill account", {
				status: response.status,
				error: errorText,
			});
			throw new Error(
				`Failed to create Kill Bill account: ${response.status}`,
			);
		}

		const accountLocation = response.headers.get("Location");
		if (!accountLocation) {
			logger.error(handlerName, "No Location header in response");
			throw new Error("Failed to get account location");
		}

		// Fetch account details from the Location URL
		const accountResponse = await fetch(accountLocation, {
			method: "GET",
			headers: this.getHeaders(),
		});

		if (!accountResponse.ok) {
			logger.error(handlerName, "Failed to fetch account details", {
				status: accountResponse.status,
			});
			throw new Error("Failed to fetch account details");
		}

		const account: KillBillAccount = await accountResponse.json();
		logger.info(handlerName, "Created new Kill Bill account", {
			accountId: account.accountId,
			externalKey: userId,
		});

		return account;
	}

	/**
	 * Get subscription by ID
	 */
	async getSubscriptionById(
		subscriptionId: string,
	): Promise<KillBillSubscription> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/subscriptions/${subscriptionId}`;

		logger.info(handlerName, "Getting subscription by ID", {
			url,
			subscriptionId: subscriptionId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(false), // Subscription endpoint doesn't need basic auth
		});

		if (!response.ok) {
			if (response.status === 404) {
				throw new Error("SUBSCRIPTION_NOT_FOUND");
			}
			logger.error(handlerName, "Failed to get subscription", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(`Failed to get subscription: ${response.status}`);
		}

		return await response.json();
	}

	/**
	 * Get subscriptions for an account
	 */
	async getAccountSubscriptions(
		accountId: string,
	): Promise<KillBillSubscription[]> {
		const handlerName = "killbill-service";
		const url =
			`${this.baseUrl}/1.0/kb/accounts/${accountId}/subscriptions`;

		logger.info(handlerName, "Getting account subscriptions", {
			url,
			accountId: accountId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(false), // Subscription endpoint doesn't need basic auth
		});

		if (!response.ok) {
			logger.error(handlerName, "Failed to get account subscriptions", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(
				`Failed to get account subscriptions: ${response.status}`,
			);
		}

		return await response.json();
	}

	/**
	 * Get active subscription for an account
	 */
	async getActiveSubscription(
		accountId: string,
	): Promise<KillBillSubscription | null> {
		const subscriptions = await this.getAccountSubscriptions(accountId);

		if (!subscriptions || subscriptions.length === 0) {
			return null;
		}

		// Get the most recent active subscription
		const activeSubscription = subscriptions
			.filter((sub: KillBillSubscription) => sub.state === "ACTIVE")
			.sort((a: KillBillSubscription, b: KillBillSubscription) =>
				new Date(b.startDate).getTime() -
				new Date(a.startDate).getTime()
			)[0];

		return activeSubscription || null;
	}

	/**
	 * Check if user has existing active subscription
	 */
	async hasActiveSubscription(
		accountId: string,
	): Promise<{ hasActive: boolean; subscription?: KillBillSubscription }> {
		const handlerName = "killbill-service";
		const url =
			`${this.baseUrl}/1.0/kb/accounts/${accountId}/bundles?externalKey=&bundlesFilter=`;

		logger.info(handlerName, "Checking for existing subscriptions", {
			url,
			accountId: accountId.substring(0, 8) + "...",
		});

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				logger.warn(handlerName, "Failed to fetch bundles", {
					status: response.status,
				});
				return { hasActive: false };
			}

			const bundles = await response.json();
			if (!bundles || bundles.length === 0) {
				return { hasActive: false };
			}

			// Check for active subscriptions (not cancelled)
			for (const bundle of bundles) {
				if (bundle.subscriptions && bundle.subscriptions.length > 0) {
					for (const sub of bundle.subscriptions) {
						if (sub.state === "ACTIVE" && !sub.cancelledDate) {
							logger.info(
								handlerName,
								"Found active subscription",
								{
									subscriptionId: sub.subscriptionId,
									planName: sub.planName,
								},
							);
							return { hasActive: true, subscription: sub };
						}
					}
				}
			}

			return { hasActive: false };
		} catch (error) {
			logger.error(handlerName, "Error checking existing subscriptions", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { hasActive: false };
		}
	}

	/**
	 * Create a subscription
	 */
	async createSubscription(
		accountId: string,
		planId: string,
	): Promise<string> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/subscriptions`;

		const subscriptionData = {
			accountId: accountId,
			externalKey: `sub-${accountId}-${Date.now()}`,
			planName: planId,
		};

		logger.info(handlerName, "Creating Kill Bill subscription", {
			url,
			accountId: accountId.substring(0, 8) + "...",
			planName: planId,
		});

		const response = await fetch(url, {
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify(subscriptionData),
		});

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(handlerName, "Failed to create subscription", {
				status: response.status,
				error: errorText,
			});
			throw new Error(
				`Failed to create subscription: ${response.status} - ${errorText}`,
			);
		}

		const subscriptionId =
			response.headers.get("Location")?.split("/").pop() || "unknown";
		logger.info(
			handlerName,
			"Created Kill Bill subscription successfully",
			{
				subscriptionId: subscriptionId.substring(0, 8) + "...",
			},
		);

		return subscriptionId;
	}

	/**
	 * Verify that a subscription belongs to a user
	 */
	async verifySubscriptionOwnership(
		subscriptionId: string,
		userId: string,
	): Promise<boolean> {
		try {
			const subscription = await this.getSubscriptionById(subscriptionId);
			const account = await this.getAccountByExternalKey(userId);

			return account?.accountId === subscription.accountId;
		} catch (error) {
			return false;
		}
	}
}

// Export singleton instance
export const killBillService = new KillBillService();
