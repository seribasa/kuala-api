// Authentication types
interface AppMetadata {
	provider?: string;
	providers?: string[];
	[key: string]: unknown;
}

interface UserMetadata {
	email?: string;
	email_verified?: boolean;
	full_name?: string;
	iss?: string;
	name?: string;
	phone_verified?: boolean;
	provider_id?: string;
	sub?: string;
	[key: string]: unknown;
}

interface IdentityData extends UserMetadata {}

interface Identity {
	identity_id?: string;
	id?: string;
	user_id?: string;
	identity_data?: IdentityData;
	provider?: string;
	last_sign_in_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	email?: string;
	[key: string]: unknown;
}

interface AuthenticatedUser {
	id: string;
	aud?: string;
	role?: string;
	email?: string;
	email_confirmed_at?: string | null;
	phone?: string | null;
	confirmed_at?: string | null;
	last_sign_in_at?: string | null;
	app_metadata?: AppMetadata;
	user_metadata?: UserMetadata;
	identities?: Identity[];
	created_at?: string | null;
	updated_at?: string | null;
	is_anonymous?: boolean;
	[key: string]: unknown;
}

// Plan and pricing types
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

// Subscription related types
interface CreateSubscriptionRequest {
	planId: string;
	interval: "month" | "year";
	promoCode?: string | null;
	paymentMethodToken?: string | null;
}

interface Subscription {
	id: string;
	userId: string;
	planId: string;
	interval: "month" | "year";
	status: "trialing" | "active" | "paused" | "canceled" | "past_due";
	startDate: string;
	currentPeriodStart: string;
	currentPeriodEnd: string;
	billing: {
		accountId: string;
		subscriptionId: string;
		bundleId: string;
	};
}

// Kill Bill Account response
interface KillBillAccount {
	accountId: string;
	name: string;
	email: string;
	externalKey: string;
	currency: string;
}

// Kill Bill Subscription response
interface KillBillSubscription {
	accountId: string;
	bundleId: string;
	subscriptionId: string;
	externalKey: string;
	startDate: string;
	productName: string;
	productCategory: string;
	billingPeriod: string;
	priceList: string;
	planName: string;
	state: string;
	sourceType: string;
	cancelledDate: string | null;
	chargedThroughDate: string;
	billingStartDate: string;
	billingEndDate: string;
	events: Array<{
		eventId: string;
		billingPeriod: string;
		effectiveDate: string;
		plan: string;
		product: string;
		priceList: string;
		eventType: string;
		isBlockedBilling: boolean;
		isBlockedEntitlement: boolean;
		serviceName: string;
		serviceStateName: string;
		phase: string;
	}>;
	priceOverrides: unknown[];
}

export type {
	AppMetadata,
	AuthenticatedUser,
	ContactUs,
	CreateSubscriptionRequest,
	Identity,
	IdentityData,
	KillBillAccount,
	KillBillCatalog,
	KillBillPrice,
	KillBillSubscription,
	Plan,
	Price,
	Subscription,
	UserMetadata,
};
