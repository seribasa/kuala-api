interface Price {
	amount: number | null;
	currency: string;
}

interface ContactUs {
	email: string;
	phone?: string;
	body: string;
}

interface Plan {
	id: string;
	name: string;
	tier: "free" | "basic" | "premium" | "enterprise";
	features: string[];
	prices: Price[];
	selectable: boolean;
	contactUs?: ContactUs | null;
}

// Kill Bill Catalog API types
interface KillBillPrice {
	currency: string;
	value: number;
}

interface KillBillPhase {
	type: string;
	prices: KillBillPrice[];
	fixedPrices: KillBillPrice[];
	duration: {
		unit: string;
		number: number;
	};
	usages: unknown[];
}

interface KillBillPlan {
	name: string;
	prettyName: string;
	recurringBillingMode: string;
	billingPeriod: string;
	phases: KillBillPhase[];
}

interface KillBillProduct {
	type: string;
	name: string;
	prettyName: string;
	plans: KillBillPlan[];
	included: unknown[];
	available: unknown[];
}

interface KillBillCatalog {
	name: string;
	effectiveDate: string;
	currencies: string[];
	units: unknown[];
	products: KillBillProduct[];
	priceLists: Array<{
		name: string;
		plans: string[];
	}>;
}
export type { ContactUs, KillBillCatalog, KillBillPrice, Plan, Price };
