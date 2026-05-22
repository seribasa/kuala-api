import { killBillConfig as getKillBillConfig } from "../../_shared/config/killbill-config.ts";
import {
	KillBillAccount,
	KillBillInvoice,
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
	): Promise<{ account: KillBillAccount; isNewAccount: boolean }> {
		const handlerName = "killbill-service";

		// Try to get existing account by external key
		const existingAccount = await this.getAccountByExternalKey(userId);
		if (existingAccount) {
			logger.info(handlerName, "Found existing Kill Bill account", {
				accountId: existingAccount.accountId,
				externalKey: userId,
			});
			return { account: existingAccount, isNewAccount: false };
		}

		// Create new account if not exists
		const newAccount = await this.createAccount(userId, email);
		return { account: newAccount, isNewAccount: true };
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
			headers: this.getHeaders(),
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
	 * Get subscription by external ID (user ID)
	 * Returns null if subscription not found (404)
	 */
	async getSubscriptionByExternalId(
		externalKey: string,
	): Promise<KillBillSubscription | null> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/subscriptions?externalKey=${
			encodeURIComponent(
				externalKey,
			)
		}`;

		logger.info(handlerName, "Getting account subscriptions", {
			url,
			accountId: externalKey.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(),
		});

		// Handle 404 as "no subscription found" - this is expected for new users
		if (response.status === 404) {
			logger.info(handlerName, "No subscription found for external key", {
				externalKey: externalKey.substring(0, 8) + "...",
			});
			return null;
		}

		if (!response.ok) {
			const responseData = await response.clone().text();
			logger.error(handlerName, "Failed to get account subscriptions", {
				response: responseData,
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
	 * Get all subscriptions for an account
	 */
	// async getAccountSubscriptions(
	// 	accountId: string,
	// ): Promise<KillBillSubscription[]> {
	// 	const handlerName = "killbill-service";
	// 	const url =
	// 		`${this.baseUrl}/1.0/kb/accounts/${accountId}/bundles?externalKey=&bundlesFilter=`;

	// 	logger.info(handlerName, "Checking for existing subscriptions", {
	// 		url,
	// 		accountId: accountId.substring(0, 8) + "...",
	// 	});

	// 	const response = await fetch(url, {
	// 		method: "GET",
	// 		headers: this.getHeaders(),
	// 	});

	// 	if (!response.ok) {
	// 		logger.error(handlerName, "Failed to fetch bundles", {
	// 			status: response.status,
	// 		});
	// 		throw new Error(
	// 			`Failed to get account subscriptions: ${response.status}`,
	// 		);
	// 	}

	// 	const bundles = await response.json();
	// 	let subscriptions: KillBillSubscription[] = [];

	// 	for (const bundle of bundles) {
	// 		if (bundle.subscriptions && bundle.subscriptions.length > 0) {
	// 			subscriptions = subscriptions.concat(bundle.subscriptions);
	// 		}
	// 	}

	// 	return subscriptions;
	// }

	/**
	 * Get active subscription for an account
	 */
	async getActiveSubscription(
		externalKey: string,
	): Promise<KillBillSubscription | null> {
		const subscription = await this.getSubscriptionByExternalId(
			externalKey,
		);

		if (subscription && subscription.state === "ACTIVE") {
			return subscription;
		}

		return null;
	}

	/**
	 * Check if user has existing active subscription
	 */
	async hasActiveSubscription(
		externalKey: string,
	): Promise<{ hasActive: boolean; subscription?: KillBillSubscription }> {
		const handlerName = "killbill-service";
		try {
			const subscription = await this.getSubscriptionByExternalId(
				externalKey,
			);
			logger.info(
				handlerName,
				`Found ${
					subscription ? "existing" : "no"
				} subscriptions for user`,
				{ externalKey },
			);
			if (!subscription) {
				return { hasActive: false };
			}

			// Check for active subscriptions (not cancelled)
			if (
				subscription.state === "ACTIVE" && !subscription.cancelledDate
			) {
				logger.info(
					handlerName,
					"Found active subscription",
					{
						subscriptionId: subscription.subscriptionId,
						planName: subscription.planName,
					},
				);
				return { hasActive: true, subscription };
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
		externalKey: string,
		accountId: string,
		planId: string,
	): Promise<string> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/subscriptions`;

		const subscriptionData = {
			accountId: accountId,
			externalKey: externalKey,
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
			// check duplicate subscription error
			if (errorText.includes("Duplicate entry")) {
				logger.error(
					handlerName,
					"Duplicate subscription detected",
					{
						accountId: accountId.substring(0, 8) + "...",
						planName: planId,
					},
				);
				throw new Error("DUPLICATE_SUBSCRIPTION");
			}
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
	 * Cancel a subscription
	 */
	async cancelSubscription(
		subscriptionId: string,
	): Promise<void> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/subscriptions/${subscriptionId}`;

		logger.info(handlerName, "Cancelling Kill Bill subscription", {
			url,
			subscriptionId: subscriptionId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "DELETE",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(handlerName, "Failed to cancel subscription", {
				status: response.status,
				error: errorText,
			});
			throw new Error(
				`Failed to cancel subscription: ${response.status} - ${errorText}`,
			);
		}

		logger.info(
			handlerName,
			"Cancelled Kill Bill subscription successfully",
			{
				subscriptionId: subscriptionId.substring(0, 8) + "...",
			},
		);
	}

	/**
	 * uncancel a subscription
	 */
	async uncancelSubscription(
		subscriptionId: string,
	): Promise<void> {
		const handlerName = "killbill-service";
		const url =
			`${this.baseUrl}/1.0/kb/subscriptions/${subscriptionId}/uncancel`;

		logger.info(handlerName, "Uncancelling Kill Bill subscription", {
			url,
			subscriptionId: subscriptionId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "PUT",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(handlerName, "Failed to uncancel subscription", {
				status: response.status,
				error: errorText,
			});
			throw new Error(
				`Failed to uncancel subscription: ${response.status} - ${errorText}`,
			);
		}

		logger.info(
			handlerName,
			"Uncancelled Kill Bill subscription successfully",
			{
				subscriptionId: subscriptionId.substring(0, 8) + "...",
			},
		);
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
			console.error("Error verifying subscription ownership:", error);
			return false;
		}
	}

	// 	Query Parameters

	// Name	Type	Required	Default	Description
	// startDate	date	false	no starting date	Return only invoices issued since this date.
	// endDate	date	false	no ending date	Return only invoices issued up to this date.
	// withMigrationInvoices	boolean	false	false	Choose true to include migration invoices
	// unpaidInvoicesOnly	boolean	false	false	Choose true to include unpaid invoices only
	// includeVoidedInvoices	boolean	false	false	Choose true to include voided invoices
	// includeInvoiceComponents	boolean	false	false	Choose true to include invoice components (like invoice items/payments, etc.)
	// invoicesFilter	string	false	empty	A comma separated list of invoiceIds to filter
	// audit	string	false	"NONE"	Level of audit information to return: "NONE", "MINIMAL", or "FULL"
	/**
	 * Get all invoices for an account
	 * @param accountId string
	 * @param startDate string | undefined
	 * @param endDate string | undefined
	 * @param withMigrationInvoices boolean | undefined
	 * @param unpaidInvoicesOnly boolean | undefined
	 * @param includeVoidedInvoices boolean | undefined
	 * @return KillBillInvoice[]
	 */
	async getAccountInvoices(
		accountId: string,
		startDate?: string,
		endDate?: string,
		withMigrationInvoices?: boolean,
		unpaidInvoicesOnly?: boolean,
		includeVoidedInvoices?: boolean,
		includeInvoiceComponents?: boolean,
		invoicesFilter?: string[],
		audit?: "NONE" | "MINIMAL" | "FULL",
	): Promise<KillBillInvoice[]> {
		const handlerName = "killbill-service";
		const searchParams = new URLSearchParams();
		if (withMigrationInvoices) {
			searchParams.append("withMigrationInvoices", "true");
		}
		if (unpaidInvoicesOnly) {
			searchParams.append("unpaidInvoicesOnly", "true");
		}
		if (includeVoidedInvoices) {
			searchParams.append("includeVoidedInvoices", "true");
		}
		if (includeInvoiceComponents) {
			searchParams.append("includeInvoiceComponents", "true");
		}
		if (startDate) {
			searchParams.append("startDate", startDate);
		}
		if (endDate) {
			searchParams.append("endDate", endDate);
		}
		if (invoicesFilter && invoicesFilter.length > 0) {
			searchParams.append("invoicesFilter", invoicesFilter.join(","));
		}
		if (audit) {
			searchParams.append("audit", audit);
		}
		const qs = searchParams.toString();
		const url = `${this.baseUrl}/1.0/kb/accounts/${accountId}/invoices${
			qs ? "?" + qs : ""
		}`;

		logger.info(handlerName, "Getting account invoices", {
			url,
			accountId: accountId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			logger.error(handlerName, "Failed to get account invoices", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(
				`Failed to get account invoices: ${response.status}`,
			);
		}

		return await response.json();
	}

	/**
	 * List invoices across the tenant
	 */
	async listInvoices(
		offset = 0,
		limit = 100,
	): Promise<KillBillInvoice[]> {
		const handlerName = "killbill-service";
		const searchParams = new URLSearchParams();
		searchParams.append("offset", offset.toString());
		searchParams.append("limit", limit.toString());

		const url =
			`${this.baseUrl}/1.0/kb/invoices/pagination?${searchParams.toString()}`;

		logger.info(handlerName, "Listing invoices", {
			url,
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			logger.error(handlerName, "Failed to list invoices", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(`Failed to list invoices: ${response.status}`);
		}

		return await response.json();
	}

	/**
	 * Search invoices across the tenant
	 */
	async searchInvoices(
		searchKey: string,
		offset = 0,
		limit = 100,
	): Promise<KillBillInvoice[]> {
		const handlerName = "killbill-service";
		// searchKey needs to be URL encoded if it contains [ ] etc.
		// However, fetch's URL will encode the path segment appropriately.
		// But if it's advanced search _q=1&..., putting it in path might be tricky.
		// Actually, Kill Bill search API is /search/{searchKey} where searchKey is a path variable.
		const encodedSearchKey = encodeURIComponent(searchKey)
			.replace(/%3D/g, "=")
			.replace(/%26/g, "&"); // Allow basic advanced search params if user provides them

		const searchParams = new URLSearchParams();
		searchParams.append("offset", offset.toString());
		searchParams.append("limit", limit.toString());

		const url =
			`${this.baseUrl}/1.0/kb/invoices/search/${encodedSearchKey}?${searchParams.toString()}`;

		logger.info(handlerName, "Searching invoices", {
			url,
			searchKey,
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			logger.error(handlerName, "Failed to search invoices", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(`Failed to search invoices: ${response.status}`);
		}

		return await response.json();
	}

	/**
	 * Get invoice by ID
	 */
	async getInvoiceById(invoiceId: string): Promise<KillBillInvoice> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/invoices/${invoiceId}`;

		logger.info(handlerName, "Getting invoice by ID", {
			url,
			invoiceId: invoiceId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "GET",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			if (response.status === 404) {
				throw new Error("INVOICE_NOT_FOUND");
			}
			logger.error(handlerName, "Failed to get invoice", {
				status: response.status,
				statusText: response.statusText,
			});
			throw new Error(`Failed to get invoice: ${response.status}`);
		}

		return await response.json();
	}

	/**
	 * Trigger invoice run for account
	 */
	async triggerInvoiceRun(
		accountId: string,
		targetDate?: string,
	): Promise<string | null> {
		const handlerName = "killbill-service";
		let url = `${this.baseUrl}/1.0/kb/invoices?accountId=${accountId}`;
		if (targetDate) {
			url += `&targetDate=${targetDate}`;
		}

		logger.info(handlerName, "Triggering invoice run", {
			url,
			accountId: accountId.substring(0, 8) + "...",
			targetDate,
		});

		const response = await fetch(url, {
			method: "POST",
			headers: this.getHeaders(),
		});

		if (response.status === 404) {
			// No invoice to generate - account is up to date
			logger.info(
				handlerName,
				"No invoice to generate - account up to date",
			);
			return null;
		}

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(handlerName, "Failed to trigger invoice run", {
				status: response.status,
				error: errorText,
			});
			throw new Error(
				`Failed to trigger invoice run: ${response.status} - ${errorText}`,
			);
		}

		// Get invoice ID from Location header
		const location = response.headers.get("Location");
		const invoiceId = location?.split("/").pop() || "unknown";

		logger.info(handlerName, "Invoice run completed successfully", {
			invoiceId: invoiceId.substring(0, 8) + "...",
		});

		return invoiceId;
	}

	/**
	 * Void an invoice
	 * @param invoiceId string
	 * @return void
	 */
	async voidInvoice(invoiceId: string): Promise<void> {
		const handlerName = "killbill-service";
		const url = `${this.baseUrl}/1.0/kb/invoices/${invoiceId}/voidInvoice`;

		logger.info(handlerName, "Voiding invoice", {
			url,
			invoiceId: invoiceId.substring(0, 8) + "...",
		});

		const response = await fetch(url, {
			method: "PUT",
			headers: this.getHeaders(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(handlerName, "Failed to void invoice", {
				status: response.status,
				error: errorText,
			});
			throw new Error(
				`Failed to void invoice: ${response.status} - ${errorText}`,
			);
		}

		logger.info(handlerName, "Voided invoice successfully", {
			invoiceId: invoiceId.substring(0, 8) + "...",
		});
	}
}

// Export singleton instance
export const killBillService = new KillBillService();
