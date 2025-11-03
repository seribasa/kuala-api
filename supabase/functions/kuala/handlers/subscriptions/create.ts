import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import {
	CreateSubscriptionRequest,
	KillBillAccount,
	KillBillSubscription,
} from "../../../_shared/types/index.ts";
import { logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";

type KillBillConfig = {
	baseUrl: string;
	apiKey: string;
	apiSecret: string;
	username: string;
	password: string;
	defaultCurrency: string;
};

function getKillBillConfig(): KillBillConfig {
	return {
		baseUrl: Deno.env.get("KILLBILL_BASE_URL") || "",
		apiKey: Deno.env.get("KILLBILL_API_KEY") || "",
		apiSecret: Deno.env.get("KILLBILL_API_SECRET") || "",
		username: Deno.env.get("KILLBILL_USERNAME") || "",
		password: Deno.env.get("KILLBILL_PASSWORD") || "",
		defaultCurrency: Deno.env.get("KILLBILL_DEFAULT_CURRENCY") || "",
	};
}

/**
 * Create or get Kill Bill account for the user
 */
async function getOrCreateKillBillAccount(
	userId: string,
	email: string,
): Promise<KillBillAccount> {
	const handlerName = "createSubscription";
	const killBillConfig = getKillBillConfig();
	const baseUrl = killBillConfig.baseUrl.replace(/\/$/, "");
	const credentials = btoa(
		`${killBillConfig.username}:${killBillConfig.password}`,
	);

	// Try to get existing account by external key
	const getAccountUrl =
		`${baseUrl}/1.0/kb/accounts?externalKey=${userId}&accountWithBalance=false&accountWithBalanceAndCBA=false`;

	logger.info(handlerName, "Checking for existing Kill Bill account", {
		url: getAccountUrl,
		externalKey: userId,
	});

	try {
		const getResponse = await fetch(getAccountUrl, {
			method: "GET",
			headers: {
				"Authorization": `Basic ${credentials}`,
				"X-Killbill-ApiKey": killBillConfig.apiKey,
				"X-Killbill-ApiSecret": killBillConfig.apiSecret,
				"Accept": "application/json",
			},
		});

		if (getResponse.ok) {
			const account: KillBillAccount = await getResponse.json();
			logger.info(handlerName, "Found existing Kill Bill account", {
				accountId: account.accountId,
			});
			return account;
		}
	} catch (error) {
		logger.warn(handlerName, "Error checking for existing account", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// Create new account if not exists
	const createAccountUrl = `${baseUrl}/1.0/kb/accounts`;
	const accountData = {
		name: email,
		email: email,
		externalKey: userId,
		currency: killBillConfig.defaultCurrency,
	};

	logger.info(handlerName, "Creating new Kill Bill account", {
		url: createAccountUrl,
		externalKey: userId,
	});

	const createResponse = await fetch(createAccountUrl, {
		method: "POST",
		headers: {
			"Authorization": `Basic ${credentials}`,
			"X-Killbill-ApiKey": killBillConfig.apiKey,
			"X-Killbill-ApiSecret": killBillConfig.apiSecret,
			"X-Killbill-CreatedBy": "kuala-api",
			"Content-Type": "application/json",
			"Accept": "application/json",
		},
		body: JSON.stringify(accountData),
	});

	if (!createResponse.ok) {
		const errorText = await createResponse.text();
		logger.error(handlerName, "Failed to create Kill Bill account", {
			status: createResponse.status,
			error: errorText,
		});
		throw new Error(
			`Failed to create Kill Bill account: ${createResponse.status}`,
		);
	}
	const accountLocation = createResponse.headers.get("Location");
	if (!accountLocation) {
		logger.error(handlerName, "No Location header in response");
		throw new Error("Failed to get account location");
	}

	// Fetch account details from the Location URL
	const accountResponse = await fetch(accountLocation, {
		method: "GET",
		headers: {
			"Authorization": `Basic ${credentials}`,
			"X-Killbill-ApiKey": killBillConfig.apiKey,
			"X-Killbill-ApiSecret": killBillConfig.apiSecret,
			"Accept": "application/json",
		},
	});

	if (!accountResponse.ok) {
		logger.error(handlerName, "Failed to fetch account details", {
			status: accountResponse.status,
		});
		throw new Error("Failed to fetch account details");
	}

	const account: KillBillAccount = await accountResponse.json();
	logger.info(handlerName, "Created new Kill Bill account", {
		account: JSON.stringify(account),
	});

	return account;
}

/**
 * Check if user already has an active subscription
 */
async function checkExistingSubscription(
	accountId: string,
): Promise<KillBillSubscription | null> {
	const handlerName = "createSubscription";
	const killBillConfig = getKillBillConfig();
	const baseUrl = killBillConfig.baseUrl.replace(/\/$/, "");
	const credentials = btoa(
		`${killBillConfig.username}:${killBillConfig.password}`,
	);

	const url =
		`${baseUrl}/1.0/kb/accounts/${accountId}/bundles?externalKey=&bundlesFilter=`;

	logger.info(handlerName, "Checking for existing subscriptions", {
		url,
		accountId,
	});

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				"Authorization": `Basic ${credentials}`,
				"X-Killbill-ApiKey": killBillConfig.apiKey,
				"X-Killbill-ApiSecret": killBillConfig.apiSecret,
				"Accept": "application/json",
			},
		});

		if (!response.ok) {
			logger.warn(handlerName, "Failed to fetch bundles", {
				status: response.status,
			});
			return null;
		}

		const bundles = await response.json();
		if (!bundles || bundles.length === 0) {
			logger.info(handlerName, "No existing bundles found");
			return null;
		}

		// Check for active subscriptions (not cancelled)
		for (const bundle of bundles) {
			if (bundle.subscriptions && bundle.subscriptions.length > 0) {
				for (const sub of bundle.subscriptions) {
					if (sub.state === "ACTIVE" && !sub.cancelledDate) {
						logger.info(handlerName, "Found active subscription", {
							subscriptionId: sub.subscriptionId,
							planName: sub.planName,
						});
						return sub;
					}
				}
			}
		}

		logger.info(handlerName, "No active subscriptions found");
		return null;
	} catch (error) {
		logger.error(handlerName, "Error checking existing subscriptions", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Create a Kill Bill subscription
 */
async function createKillBillSubscription(
	accountId: string,
	planId: string,
): Promise<string> {
	const handlerName = "createSubscription";
	const killBillConfig = getKillBillConfig();
	const baseUrl = killBillConfig.baseUrl.replace(/\/$/, "");
	const credentials = btoa(
		`${killBillConfig.username}:${killBillConfig.password}`,
	);

	// Construct plan name based on planId and interval
	// Example: basic + month = basic-monthly, premium + year = premium-annual
	const planName = planId;

	const subscriptionData = {
		accountId: accountId,
		externalKey: `sub-${accountId}-${Date.now()}`,
		planName: planName,
	};

	const url = `${baseUrl}/1.0/kb/subscriptions`;

	logger.info(handlerName, "Creating Kill Bill subscription", {
		url,
		accountId,
		planName,
	});

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Basic ${credentials}`,
			"X-Killbill-ApiKey": killBillConfig.apiKey,
			"X-Killbill-ApiSecret": killBillConfig.apiSecret,
			"X-Killbill-CreatedBy": "kuala-api",
			"Content-Type": "application/json",
			"Accept": "application/json",
		},
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

	const subscriptionId = response.headers.get("Location")?.split("/").pop() ||
		"unknown";
	logger.info(handlerName, "Created Kill Bill subscription successfully", {
		subscriptionId: subscriptionId,
	});

	return subscriptionId;
}

/**
 * Handler for POST /subscriptions
 * Creates a subscription for the authenticated user
 * Note: Requires authMiddleware to be applied
 */
export async function handleCreateSubscription(c: Context) {
	const handlerName = "createSubscription";
	logger.info(handlerName, "Starting subscription creation");

	try {
		// 1. Get authenticated user from context (set by authMiddleware)
		const user = getUser(c);

		// 2. Parse and validate request body
		const body = await c.req.json() as CreateSubscriptionRequest;
		const { planId } = body;

		logger.info(handlerName, "Request validated", {
			userId: user.id,
			planId,
		});

		if (!planId) {
			logger.error(handlerName, "Missing planId");
			const errorResponse: ErrorResponse = {
				code: "MISSING_PLAN_ID",
				message: "planId is required",
			};
			return c.json(errorResponse, 400);
		}

		// 3. Get or create Kill Bill account
		const account = await getOrCreateKillBillAccount(
			user.id,
			user.email || "",
		);

		// 4. Check for existing active subscription
		const existingSubscription = await checkExistingSubscription(
			account.accountId,
		);

		if (existingSubscription) {
			logger.warn(handlerName, "User already has active subscription", {
				subscriptionId: existingSubscription.subscriptionId,
				planName: existingSubscription.planName,
			});

			const errorResponse: ErrorResponse = {
				code: "ALREADY_SUBSCRIBED",
				message: "Already subscribed to a non-cancellable plan",
			};
			return c.json(errorResponse, 409);
		}

		// 5. Create subscription in Kill Bill
		let subscriptionId: string;
		try {
			subscriptionId = await createKillBillSubscription(
				account.accountId,
				planId,
			);
		} catch (_) {
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_CREATION_FAILED",
				message: "Failed to create subscription",
			};
			return c.json(errorResponse, 500);
		}

		const baseUrl = new URL(c.req.url).origin;
		c.res.headers.set(
			"Location",
			`${baseUrl}/subscriptions/${subscriptionId}`,
		);

		return c.json(null, 201);
	} catch (error) {
		logger.error(handlerName, "Unexpected error", {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Failed to create subscription",
		};
		return c.json(errorResponse, 500);
	}
}
