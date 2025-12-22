// Event Types for the Subscription System

export interface BaseEvent {
	eventId: string;
	correlationId: string;
	timestamp: string; // ISO8601
	metadata: Record<string, unknown>;
}

export interface SubscriptionRequestedEvent extends BaseEvent {
	type: "SubscriptionRequested";
	userId: string;
	planId: string;
	email: string;
	name: string;
	metadata: {
		source: "api";
	};
}

export interface AccountReadyEvent extends BaseEvent {
	type: "AccountReady";
	userId: string;
	accountId: string;
	name: string;
	email: string;
	currency: string;
	planId: string;
	metadata: {
		createdNew: boolean;
	};
}

export interface SubscriptionCreatedEvent extends BaseEvent {
	type: "SubscriptionCreated";
	userId: string;
	accountId: string;
	subscriptionId: string;
	planId: string;
	metadata: Record<PropertyKey, never>;
}

export interface InvoiceGeneratedEvent extends BaseEvent {
	type: "InvoiceGenerated";
	userId: string;
	accountId: string;
	subscriptionId: string;
	invoiceId: string;
	metadata: Record<PropertyKey, never>;
}

export type DomainEvent =
	| SubscriptionRequestedEvent
	| AccountReadyEvent
	| SubscriptionCreatedEvent
	| InvoiceGeneratedEvent;

// Event creation helpers
export function createSubscriptionRequestedEvent(
	correlationId: string,
	userId: string,
	planId: string,
	email: string,
	name: string,
): SubscriptionRequestedEvent {
	return {
		eventId: crypto.randomUUID(),
		correlationId,
		timestamp: new Date().toISOString(),
		type: "SubscriptionRequested",
		userId,
		planId,
		email,
		name,
		metadata: { source: "api" },
	};
}

export function createAccountReadyEvent(
	correlationId: string,
	userId: string,
	accountId: string,
	name: string,
	email: string,
	currency: string,
	planId: string,
	createdNew: boolean,
): AccountReadyEvent {
	return {
		eventId: crypto.randomUUID(),
		correlationId,
		timestamp: new Date().toISOString(),
		type: "AccountReady",
		userId,
		accountId,
		name,
		email,
		currency,
		planId,
		metadata: { createdNew },
	};
}

export function createSubscriptionCreatedEvent(
	correlationId: string,
	userId: string,
	accountId: string,
	subscriptionId: string,
	planId: string,
): SubscriptionCreatedEvent {
	return {
		eventId: crypto.randomUUID(),
		correlationId,
		timestamp: new Date().toISOString(),
		type: "SubscriptionCreated",
		userId,
		accountId,
		subscriptionId,
		planId,
		metadata: {} as Record<PropertyKey, never>,
	};
}

export function createInvoiceGeneratedEvent(
	correlationId: string,
	userId: string,
	accountId: string,
	subscriptionId: string,
	invoiceId: string,
): InvoiceGeneratedEvent {
	return {
		eventId: crypto.randomUUID(),
		correlationId,
		timestamp: new Date().toISOString(),
		type: "InvoiceGenerated",
		userId,
		accountId,
		subscriptionId,
		invoiceId,
		metadata: {} as Record<PropertyKey, never>,
	};
}
