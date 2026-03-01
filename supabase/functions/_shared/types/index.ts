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

// Kill Bill Invoice Item types
// productName	string	system	Name of the Product for this subscription if any
// planName	string	system	Name of the Plan for this subscription if any
// phaseName	string	system	Name of the PlanPhase for this subscription if any
// usageName	string	system	Name of the Usage section for this subscription if any
// prettyProductName	string	system	Pretty name of the Product for this subscription if any
// prettyPlanName	string	system	Pretty name of the Plan for this subscription if any
// prettyPhaseName	string	system	Pretty name of the PlanPhase for this subscription if any
// prettyUsageName	string	system	Pretty name of the Usage section for this subscription if any
// itemType	string	system	Item type (see below)
// description	string	user or system	Optional description of the item
// startDate	date	user or system	Start date of the period invoiced
// endDate	date	user or system	End date of the period invoiced
// amount	number	user or system	Amount being invoiced
// rate	number	user or system	Rate associated with the Plan
// currency	string	user or system	Currency associated with the account
// quantity	number	system	Quantity of usage blocks (number of units/block size). Applicable only for itemType=USAGE and when org.killbill.invoice.item.result.behavior.mode=DETAIL is specified
// itemDetails	string	system	JSON list correpsonding to usage items being invoiced. It contains one entry per tier
// catalogEffectiveDate	DateTime	system	The effective date of the underlying catalog. Applicable only for itemType=RECURRING
// childItems	list	user or system	In the hierarchical model, the items for the children.
// auditLogs	array	system	Array of audit log records for
interface KillBillInvoiceItem {
	invoiceItemId: string;
	invoiceId: string;
	linkedInvoiceItemId?: string | null;
	accountId: string;
	childAccountId?: string | null;
	bundleId?: string | null;
	subscriptionId?: string | null;
	productName?: string | null;
	planName?: string | null;
	phaseName?: string | null;
	usageName?: string | null;
	prettyProductName?: string | null;
	prettyPlanName?: string | null;
	prettyPhaseName?: string | null;
	prettyUsageName?: string | null;
	itemType:
		| "EXTERNAL_CHARGE"
		| "FIXED"
		| "RECURRING"
		| "REPAIR_ADJ"
		| "CBA_ADJ"
		| "CREDIT_ADJ"
		| "ITEM_ADJ"
		| "TAX"
		| "USAGE";
	description?: string | null;
	startDate: string;
	endDate?: string | null;
	amount: number;
	rate?: number | null;
	currency: string;
	quantity?: number | null;
	itemDetails?: string | null;
	catalogEffectiveDate?: string | null;
	childItems?: KillBillInvoiceItem[] | null;
	auditLogs?: unknown[];
}

// Kill Bill Invoice response
interface KillBillInvoice {
	invoiceId: string;
	accountId: string;
	amount: number;
	currency: string;
	status: "DRAFT" | "COMMITTED" | "VOID";
	creditAdj: number;
	refundAdj: number;
	invoiceDate: string;
	targetDate: string;
	invoiceNumber?: number | null;
	balance: number;
	bundleKeys?: string[] | null;
	credits?: unknown[] | null;
	items: KillBillInvoiceItem[];
	trackingIds?: string[];
	isParentInvoice?: boolean;
	parentInvoiceId?: string | null;
	parentAccountId?: string | null;
	auditLogs?: unknown[];
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
	KillBillInvoice,
	KillBillInvoiceItem,
	KillBillPrice,
	KillBillSubscription,
	Plan,
	Price,
	Subscription,
	UserMetadata,
};
