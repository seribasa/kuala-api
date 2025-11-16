import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import {
	KillBillCatalog,
	KillBillPrice,
	Plan,
	Price,
} from "../../../_shared/types/index.ts";
import { logger } from "../../middleware/logger.ts";

type KillBillConfig = {
	baseUrl: string;
	apiKey: string;
	apiSecret: string;
	username: string;
	password: string;
};

type EnterpriseContactConfig = {
	email: string;
	phone: string;
	body: string;
};

function getKillBillConfig(): KillBillConfig {
	return {
		baseUrl: Deno.env.get("KILLBILL_BASE_URL") || "",
		apiKey: Deno.env.get("KILLBILL_API_KEY") || "",
		apiSecret: Deno.env.get("KILLBILL_API_SECRET") || "",
		username: Deno.env.get("KILLBILL_USERNAME") || "",
		password: Deno.env.get("KILLBILL_PASSWORD") || "",
	};
}

function getEnterpriseContactConfig(): EnterpriseContactConfig {
	return {
		email: Deno.env.get("ENTERPRISE_CONTACT_EMAIL") || "",
		phone: Deno.env.get("ENTERPRISE_CONTACT_PHONE") || "",
		body: Deno.env.get("ENTERPRISE_CONTACT_MESSAGE") || "",
	};
}

// Mapping from Kill Bill product names to our tiers
const PRODUCT_TIER_MAPPING: Record<
	string,
	"free" | "basic" | "premium" | "enterprise"
> = {
	"Free": "free",
	"Basic": "basic",
	"Premium": "premium",
	"Enterprise": "enterprise",
};

export async function fetchKillBillPlans(): Promise<Plan[]> {
	const killBillConfig = getKillBillConfig();
	const enterpriseContactConfig = getEnterpriseContactConfig();
	const baseUrl = killBillConfig.baseUrl.replace(/\/$/, "");
	const url = baseUrl ? `${baseUrl}/1.0/kb/catalog` : "/1.0/kb/catalog";

	// Create basic auth header
	const credentials = btoa(
		`${killBillConfig.username}:${killBillConfig.password}`,
	);

	try {
		logger.info("plans", "Fetching catalog from Kill Bill", { url });

		const response = await fetch(url, {
			method: "GET",
			headers: {
				"Authorization": `Basic ${credentials}`,
				"X-Killbill-ApiKey": killBillConfig.apiKey,
				"X-Killbill-ApiSecret": killBillConfig.apiSecret,
				"Accept": "application/json",
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Kill Bill API error: ${response.status} ${response.statusText}`,
			);
		}

		const catalogs: KillBillCatalog[] = await response.json();
		logger.info("plans", "Catalog response received", {
			catalogCount: catalogs.length,
		});

		// Use the most recent catalog (from last index)
		const catalog = catalogs[catalogs.length - 1];
		if (!catalog) {
			throw new Error("No catalog available from Kill Bill");
		}

		// Extract all plans from all products
		const plans: Plan[] = [];

		catalog.products.forEach((product) => {
			product.plans.forEach((plan) => {
				// Skip plans that don't have an EVERGREEN phase or are not in the default price list
				const evergreenPhase = plan.phases.find((phase) =>
					phase.type === "EVERGREEN"
				);
				if (!evergreenPhase) return;

				// Check if plan is in default price list
				const defaultPriceList = catalog.priceLists.find((pl) =>
					pl.name === "DEFAULT"
				);
				if (!defaultPriceList?.plans.includes(plan.name)) return;

				// Determine tier from product name
				const tier = PRODUCT_TIER_MAPPING[product.name] || "basic";

				// Use actual included features from Kill Bill, or fallback to predefined features
				let features: string[] = [];
				if (product.included && product.included.length > 0) {
					// Convert Kill Bill included features to human-readable format
					features = (product.included as string[]).map((feature) =>
						feature.replace(/-/g, " ").replace(
							/\b\w/g,
							(l) => l.toUpperCase(),
						)
					);
				}

				// Extract prices from the EVERGREEN phase
				const prices: Price[] = evergreenPhase.prices.map((
					price: KillBillPrice,
				) => ({
					currency: price.currency,
					// Kill Bill prices are already in dollar format (not cents)
					amount: price.value,
				}));

				// Create the plan object
				const transformedPlan: Plan = {
					id: plan.name,
					name: product.prettyName || product.name,
					tier,
					features,
					prices,
					selectable: tier !== "enterprise",
				};

				// Add contact info for enterprise plans
				if (tier === "enterprise") {
					transformedPlan.contactUs = {
						email: enterpriseContactConfig.email,
						phone: enterpriseContactConfig.phone,
						body: enterpriseContactConfig.body,
					};
				}

				plans.push(transformedPlan);
			});
		});

		logger.info("plans", "Transformed plans from Kill Bill catalog", {
			planCount: plans.length,
		});
		return plans;
	} catch (error) {
		logger.error("plans", "Error fetching from Kill Bill", {
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export async function handlePlans(c: Context) {
	try {
		// Get the interval query parameter
		const interval = c.req.query("interval");

		try {
			// filter by interval if provided
			if (interval) {
				if (interval !== "month" && interval !== "year") {
					const errorResponse: ErrorResponse = {
						code: "INVALID_INTERVAL",
						message: "Interval must be 'month' or 'year'",
					};
					return c.json(errorResponse, 400);
				}
			}
			// Try to fetch from Kill Bill first
			const plans = await fetchKillBillPlans();

			// If interval is specified, filter plans accordingly by id contains 'annual' for year or 'monthly' for month
			const filteredPlans = interval
				? plans.filter((plan) =>
					interval === "year"
						? plan.id.toLowerCase().includes("annual")
						: plan.id.toLowerCase().includes("monthly")
				)
				: plans;

			if (filteredPlans.length === 0) {
				const errorResponse: ErrorResponse = {
					code: "NO_PLANS_AVAILABLE",
					message: "No plans available for the specified interval",
				};
				return c.json(errorResponse, 404);
			}

			logger.info("plans", "Returning plans", {
				interval: interval || "all",
				planCount: filteredPlans.length,
			});

			return c.json(filteredPlans, 200);
		} catch (killBillError) {
			logger.warn("plans", "Kill Bill unavailable, using fallback", {
				error: killBillError instanceof Error
					? killBillError.message
					: String(killBillError),
			});
			const errorMessage: ErrorResponse = {
				code: "KILLBILL_UNAVAILABLE",
				message: "Kill Bill service is currently unavailable",
			};

			return c.json(errorMessage, 503);
		}
	} catch (error) {
		logger.error("plans", "Unexpected error in plans handler", {
			error: error instanceof Error ? error.message : String(error),
		});
		return c.json({
			code: "INTERNAL_ERROR",
			message: "Failed to fetch plans",
		}, 500);
	}
}
