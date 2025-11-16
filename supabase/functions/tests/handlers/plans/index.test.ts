import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import type { Plan } from "../../../_shared/types/index.ts";

interface JsonResponse {
	data: unknown;
	status: number;
}

class MockResponse {
	constructor(
		private body: unknown,
		private statusCode: number,
		private okValue = true,
		private statusTextValue = "OK",
	) {}

	get ok() {
		return this.okValue;
	}

	get status() {
		return this.statusCode;
	}

	get statusText() {
		return this.statusTextValue;
	}

	json() {
		return Promise.resolve(this.body);
	}
}

function createMockContext(interval?: string) {
	return {
		req: {
			query: (name: string) => name === "interval" ? interval : undefined,
		},
		json: (data: Record<string, unknown>, status?: number) =>
			({
				data,
				status: status ?? 200,
			}) as JsonResponse,
	} as unknown as Context;
}

const defaultEnvValues: Record<string, string> = {
	KILLBILL_BASE_URL: "https://killbill.example.com",
	KILLBILL_API_KEY: "test_api_key",
	KILLBILL_API_SECRET: "test_api_secret",
	KILLBILL_USERNAME: "api_user",
	KILLBILL_PASSWORD: "api_password",
	ENTERPRISE_CONTACT_EMAIL: "enterprise@example.com",
	ENTERPRISE_CONTACT_PHONE: "+123456789",
	ENTERPRISE_CONTACT_MESSAGE: "Tell us your needs",
};

for (const [key, value] of Object.entries(defaultEnvValues)) {
	Deno.env.set(key, value);
}

const { handlePlans, fetchKillBillPlans } = await import(
	"../../../kuala/handlers/plans/index.ts"
);

function createMockCatalog() {
	return [
		{
			name: "Test Catalog",
			effectiveDate: "2025-01-01",
			currencies: ["USD"],
			units: [],
			products: [
				{
					type: "BASE",
					name: "Basic",
					prettyName: "Basic Plan",
					plans: [
						{
							name: "basic-monthly",
							prettyName: "Basic Monthly",
							recurringBillingMode: "IN_ADVANCE",
							billingPeriod: "MONTHLY",
							phases: [
								{
									type: "EVERGREEN",
									prices: [{ currency: "USD", value: 25 }],
									fixedPrices: [],
									duration: { unit: "UNLIMITED", number: 0 },
									usages: [],
								},
							],
						},
					],
					included: ["priority-support"],
					available: [],
				},
				{
					type: "BASE",
					name: "Enterprise",
					prettyName: "Enterprise Plan",
					plans: [
						{
							name: "enterprise-annual",
							prettyName: "Enterprise Annual",
							recurringBillingMode: "IN_ADVANCE",
							billingPeriod: "ANNUAL",
							phases: [
								{
									type: "EVERGREEN",
									prices: [{ currency: "USD", value: 199 }],
									fixedPrices: [],
									duration: { unit: "UNLIMITED", number: 0 },
									usages: [],
								},
							],
						},
					],
					included: [],
					available: [],
				},
			],
			priceLists: [
				{
					name: "DEFAULT",
					plans: ["basic-monthly", "enterprise-annual"],
				},
			],
		},
	];
}

Deno.test("handlePlans - should return plans from Kill Bill", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					createMockCatalog(),
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;
		const plans = response.data as Plan[];

		assertEquals(response.status, 200);
		assertEquals(plans.length, 2);

		const [basicPlan, enterprisePlan] = plans;

		assertEquals(basicPlan.id, "basic-monthly");
		assertEquals(basicPlan.tier, "basic");
		assertEquals(basicPlan.features, ["Priority Support"]);
		assertEquals(basicPlan.prices, [{ currency: "USD", amount: 25 }]);
		assertEquals(basicPlan.selectable, true);

		assertEquals(enterprisePlan.id, "enterprise-annual");
		assertEquals(enterprisePlan.tier, "enterprise");
		assertEquals(enterprisePlan.selectable, false);
		assertEquals(enterprisePlan.contactUs, {
			email: defaultEnvValues.ENTERPRISE_CONTACT_EMAIL,
			phone: defaultEnvValues.ENTERPRISE_CONTACT_PHONE,
			body: defaultEnvValues.ENTERPRISE_CONTACT_MESSAGE,
		});

		assertEquals(fetchStub.calls.length, 1);
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should filter plans by interval", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					createMockCatalog(),
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const yearResponse = await handlePlans(
			createMockContext("year"),
		) as unknown as JsonResponse;
		const yearPlans = yearResponse.data as Plan[];

		assertEquals(yearResponse.status, 200);
		assertEquals(yearPlans.length, 1);
		assertEquals(yearPlans[0].id, "enterprise-annual");

		const monthResponse = await handlePlans(
			createMockContext("month"),
		) as unknown as JsonResponse;
		const monthPlans = monthResponse.data as Plan[];

		assertEquals(monthResponse.status, 200);
		assertEquals(monthPlans.length, 1);
		assertEquals(monthPlans[0].id, "basic-monthly");
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 400 for invalid interval", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			throw new Error("fetch should not be called");
		},
	);

	try {
		const response = await handlePlans(
			createMockContext("weekly"),
		) as unknown as JsonResponse;

		assertEquals(response.status, 400);
		assertEquals(response.data, {
			code: "INVALID_INTERVAL",
			message: "Interval must be 'month' or 'year'",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 404 when no plans match interval", async () => {
	const catalog = createMockCatalog();
	// Remove monthly plan so only annual remains
	catalog[0].products[0].plans = catalog[0].products[0].plans.filter((plan) =>
		plan.name !== "basic-monthly"
	);
	catalog[0].priceLists[0].plans = ["enterprise-annual"];

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(catalog, 200, true) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext("month"),
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data, {
			code: "NO_PLANS_AVAILABLE",
			message: "No plans available for the specified interval",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 503 when Kill Bill is unavailable", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.reject(new Error("Kill Bill down")),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;

		assertEquals(response.status, 503);
		assertEquals(response.data, {
			code: "KILLBILL_UNAVAILABLE",
			message: "Kill Bill service is currently unavailable",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should skip plans without evergreen or outside default list", async () => {
	const catalog = createMockCatalog();

	catalog[0].products[0].plans.push({
		name: "basic-trial",
		prettyName: "Basic Trial",
		recurringBillingMode: "IN_ADVANCE",
		billingPeriod: "MONTHLY",
		phases: [
			{
				type: "TRIAL",
				prices: [{ currency: "USD", value: 0 }],
				fixedPrices: [],
				duration: { unit: "DAYS", number: 14 },
				usages: [],
			},
		],
	});

	catalog[0].products[0].plans.push({
		name: "basic-not-default",
		prettyName: "Basic Not Default",
		recurringBillingMode: "IN_ADVANCE",
		billingPeriod: "MONTHLY",
		phases: [
			{
				type: "EVERGREEN",
				prices: [{ currency: "USD", value: 30 }],
				fixedPrices: [],
				duration: { unit: "UNLIMITED", number: 0 },
				usages: [],
			},
		],
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(catalog, 200, true) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;
		const plans = response.data as Plan[];

		assertEquals(response.status, 200);
		assertEquals(plans.length, 2);
		assertEquals(
			plans.some((plan) => plan.id === "basic-trial"),
			false,
		);
		assertEquals(
			plans.some((plan) => plan.id === "basic-not-default"),
			false,
		);
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should use fallback tier and name when mapping is missing", async () => {
	const catalog = createMockCatalog();
	catalog[0].products.push({
		type: "BASE",
		name: "Pro",
		prettyName: "",
		plans: [
			{
				name: "pro-monthly",
				prettyName: "",
				recurringBillingMode: "IN_ADVANCE",
				billingPeriod: "MONTHLY",
				phases: [
					{
						type: "EVERGREEN",
						prices: [{ currency: "USD", value: 49 }],
						fixedPrices: [],
						duration: { unit: "UNLIMITED", number: 0 },
						usages: [],
					},
				],
			},
		],
		included: undefined as unknown as string[],
		available: [],
	});
	catalog[0].priceLists[0].plans.push("pro-monthly");

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(catalog, 200, true) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;
		const plans = response.data as Plan[];

		const proPlan = plans.find((plan) => plan.id === "pro-monthly");
		assertEquals(proPlan?.tier, "basic");
		assertEquals(proPlan?.name, "Pro");
		assertEquals(proPlan?.features, []);
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 503 when Kill Bill responds with error status", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					{},
					500,
					false,
					"Internal Server Error",
				) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;

		assertEquals(response.status, 503);
		assertEquals(response.data, {
			code: "KILLBILL_UNAVAILABLE",
			message: "Kill Bill service is currently unavailable",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 404 when default price list is missing", async () => {
	const catalog = createMockCatalog();
	catalog[0].priceLists = [
		{
			name: "PROMO",
			plans: ["basic-monthly"],
		},
	];

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(catalog, 200, true) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data, {
			code: "NO_PLANS_AVAILABLE",
			message: "No plans available for the specified interval",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 503 when Kill Bill catalog is empty", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse([], 200, true) as unknown as Response,
			),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;

		assertEquals(response.status, 503);
		assertEquals(response.data, {
			code: "KILLBILL_UNAVAILABLE",
			message: "Kill Bill service is currently unavailable",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should handle non-Error rejection from Kill Bill", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.reject("Kill Bill string error"),
	);

	try {
		const response = await handlePlans(
			createMockContext(),
		) as unknown as JsonResponse;

		assertEquals(response.status, 503);
		assertEquals(response.data, {
			code: "KILLBILL_UNAVAILABLE",
			message: "Kill Bill service is currently unavailable",
		});
	} finally {
		fetchStub.restore();
	}
});

Deno.test("handlePlans - should return 500 when query parsing fails", async () => {
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			throw new Error("fetch should not be called");
		},
	);

	const context = {
		req: {
			query: () => {
				throw new Error("Query failure");
			},
		},
		json: (data: Record<string, unknown>, status?: number) =>
			({
				data,
				status: status ?? 200,
			}) as JsonResponse,
	} as unknown as Context;

	try {
		const response = await handlePlans(context) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data, {
			code: "INTERNAL_ERROR",
			message: "Failed to fetch plans",
		});
		assertEquals(fetchStub.calls.length, 0);
	} finally {
		fetchStub.restore();
	}
});

Deno.test("fetchKillBillPlans - should fall back to defaults when env values missing", async () => {
	const targetedKeys = new Set([
		"KILLBILL_BASE_URL",
		"KILLBILL_API_KEY",
		"KILLBILL_API_SECRET",
		"KILLBILL_USERNAME",
		"KILLBILL_PASSWORD",
		"ENTERPRISE_CONTACT_EMAIL",
		"ENTERPRISE_CONTACT_PHONE",
		"ENTERPRISE_CONTACT_MESSAGE",
	]);

	const originalGet = Deno.env.get.bind(Deno.env);
	const envGetStub = stub(
		Deno.env,
		"get",
		(key: string) => targetedKeys.has(key) ? undefined : originalGet(key),
	);

	const fetchStub = stub(
		globalThis,
		"fetch",
		(_url: RequestInfo | URL, _init?: RequestInit) =>
			Promise.resolve(
				new MockResponse(
					createMockCatalog(),
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const plans = await fetchKillBillPlans();
		const [{ args }] = fetchStub.calls;
		const requestUrl = args[0] as string;
		const requestInit = args[1] as RequestInit | undefined;
		const headers = requestInit?.headers as
			| Record<string, string>
			| undefined;

		assertEquals(requestUrl, "/1.0/kb/catalog");
		assertEquals(headers?.["X-Killbill-ApiKey"], "");
		assertEquals(headers?.["Authorization"], `Basic ${btoa(":")}`);

		const enterprisePlan = plans.find((plan: Plan) =>
			plan.tier === "enterprise"
		);
		assertEquals(enterprisePlan?.contactUs, {
			email: "",
			phone: "",
			body: "",
		});
	} finally {
		fetchStub.restore();
		envGetStub.restore();
	}
});
