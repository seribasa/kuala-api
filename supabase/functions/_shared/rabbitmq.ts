// RabbitMQ Connection and Event Handling for Supabase Edge Functions
import { Connection } from "rabbitmq-client";
import { DomainEvent } from "./types/events.ts";
import { classifyError } from "./errors/index.ts";

// Custom Error Classes
export class RabbitMQConnectionError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "RabbitMQConnectionError";
	}
}

export class RabbitMQPublishError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "RabbitMQPublishError";
	}
}

export class RabbitMQConsumerError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "RabbitMQConsumerError";
	}
}

// Connection States
enum ConnectionState {
	DISCONNECTED = "DISCONNECTED",
	CONNECTING = "CONNECTING",
	CONNECTED = "CONNECTED",
	ERROR = "ERROR",
}

interface RabbitMQConfig {
	url: string;
	exchange: string;
	deadLetterExchange: string;
	queues: {
		subscriptionRequested: string;
		accountReady: string;
		subscriptionCreated: string;
		invoiceGenerated: string;
		deadLetter: string;
	};
	retry: {
		maxRetries: number;
		baseDelayMs: number;
		maxDelayMs: number;
	};
}

// For development, you might use CloudAMQP or a local RabbitMQ instance
// For production, consider using RabbitMQ on Railway, Render, or AWS
const rabbitmqUrl = Deno.env.get("RABBITMQ_URL");
if (!rabbitmqUrl) {
	throw new Error("RABBITMQ_URL not set");
}

const config: RabbitMQConfig = {
	url: rabbitmqUrl,
	exchange: "subscription-events",
	deadLetterExchange: "subscription-events-dlx",
	queues: {
		subscriptionRequested: "subscription-requested",
		accountReady: "account-ready",
		subscriptionCreated: "subscription-created",
		invoiceGenerated: "invoice-generated",
		deadLetter: "subscription-dead-letter",
	},
	retry: {
		maxRetries: 3,
		baseDelayMs: 1000,
		maxDelayMs: 30000,
	},
};

// Type for Connection factory - allows dependency injection for testing
// deno-lint-ignore no-explicit-any
export type ConnectionFactory = (url: string) => any;

export class RabbitMQClient {
	private connection: Connection | null = null;
	// deno-lint-ignore no-explicit-any
	private publisher: any | null = null;
	// deno-lint-ignore no-explicit-any
	private consumer: any | null = null;
	private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
	private connectionRetries = 0;
	private reconnectDelay = 1000; // Start with 1 second
	private maxReconnectDelay = 30000; // Max 30 seconds
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	// Store consumer configurations for auto-resume after reconnection
	private consumerConfigs: Array<{
		queueName: string;
		// deno-lint-ignore no-explicit-any
		handler: (event: any) => Promise<void>;
		options: { handlerTimeoutMs?: number; maxRetries?: number };
	}> = [];
	// Connection factory for dependency injection (testing)
	private connectionFactory: ConnectionFactory;

	/**
	 * Create a new RabbitMQClient
	 * @param connectionFactory Optional factory function for creating Connection instances.
	 *                          Defaults to the real rabbitmq-client Connection class.
	 *                          Inject a mock factory for testing.
	 */
	constructor(connectionFactory?: ConnectionFactory) {
		// Use provided factory or default to real Connection class
		this.connectionFactory = connectionFactory ||
			((url: string) => new Connection(url));
	}

	async connect(): Promise<void> {
		if (this.connectionState === ConnectionState.CONNECTED) {
			return;
		}

		if (this.connectionState === ConnectionState.CONNECTING) {
			throw new RabbitMQConnectionError("Connection already in progress");
		}

		try {
			this.connectionState = ConnectionState.CONNECTING;
			console.log(
				`🔌 Connecting to RabbitMQ (attempt ${
					this.connectionRetries + 1
				})...`,
			);

			const rabbitmq = this.connectionFactory(config.url);

			// Set up connection event handlers
			// deno-lint-ignore no-explicit-any
			rabbitmq.on("error", (err: any) => {
				console.error("❌ RabbitMQ connection error:", err);
				this.connectionState = ConnectionState.ERROR;
				this.connection = null;
				this.scheduleReconnect();
			});

			rabbitmq.on("connection", async () => {
				console.log("✅ RabbitMQ connection established");
				this.connectionState = ConnectionState.CONNECTED;
				this.connection = rabbitmq;
				this.connectionRetries = 0;
				this.reconnectDelay = 1000; // Reset delay

				// Reset publisher to force recreation
				this.publisher = null;

				// Recreate all consumers that were previously registered
				await this.recreateAllConsumers();
			});

			// Wait for connection to be established
			await this.waitForConnection();
		} catch (error) {
			this.connectionState = ConnectionState.ERROR;
			console.error("❌ Failed to establish RabbitMQ connection:", error);
			throw new RabbitMQConnectionError(
				"Failed to connect to RabbitMQ",
				error,
			);
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}

		this.connectionRetries++;
		const delay = Math.min(
			this.reconnectDelay * Math.pow(2, this.connectionRetries - 1),
			this.maxReconnectDelay,
		);

		console.log(
			`🔄 Scheduling reconnection in ${delay}ms (attempt ${this.connectionRetries}) - Infinite retry enabled for HA RabbitMQ`,
		);

		this.reconnectTimeout = setTimeout(async () => {
			try {
				await this.connect();
			} catch (error) {
				console.error("❌ Reconnection failed:", error);
			}
		}, delay);
	}

	private waitForConnection(timeoutMs = 10000): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				clearInterval(checkInterval);
				reject(new RabbitMQConnectionError("Connection timeout"));
			}, timeoutMs);

			const checkInterval = setInterval(() => {
				if (this.connectionState === ConnectionState.CONNECTED) {
					clearTimeout(timeout);
					clearInterval(checkInterval);
					resolve();
				} else if (this.connectionState === ConnectionState.ERROR) {
					clearTimeout(timeout);
					clearInterval(checkInterval);
					reject(new RabbitMQConnectionError("Connection failed"));
				}
			}, 100);
		});
	}

	async publishEvent<T extends DomainEvent>(
		routingKey: string,
		event: T,
	): Promise<void> {
		// Validate inputs
		if (!routingKey?.trim()) {
			throw new RabbitMQPublishError("Routing key cannot be empty");
		}

		if (!event || !event.eventId || !event.type) {
			throw new RabbitMQPublishError(
				"Invalid event: missing required fields (eventId, type)",
			);
		}

		try {
			// Ensure connection is established
			if (this.connectionState !== ConnectionState.CONNECTED) {
				throw new RabbitMQPublishError(
					"RabbitMQ connection not established",
				);
			}

			if (!this.connection) {
				throw new RabbitMQPublishError("RabbitMQ connection is null");
			}

			// Setup publisher if not already created
			if (!this.publisher) {
				try {
					this.publisher = this.connection.createPublisher({
						// Retry configuration
						maxAttempts: config.retry.maxRetries,
						// Declare queues and exchanges
						confirm: true,
						exchanges: [
							{
								exchange: config.exchange,
								type: "topic",
								durable: true,
							},
							{
								exchange: config.deadLetterExchange,
								type: "topic",
								durable: true,
							},
						],
						queues: [
							{
								queue: config.queues.subscriptionRequested,
								durable: true,
								arguments: {
									"x-dead-letter-exchange":
										config.deadLetterExchange,
									"x-dead-letter-routing-key": "failed",
								},
							},
							{
								queue: config.queues.accountReady,
								durable: true,
								arguments: {
									"x-dead-letter-exchange":
										config.deadLetterExchange,
									"x-dead-letter-routing-key": "failed",
								},
							},
							{
								queue: config.queues.subscriptionCreated,
								durable: true,
								arguments: {
									"x-dead-letter-exchange":
										config.deadLetterExchange,
									"x-dead-letter-routing-key": "failed",
								},
							},
							{
								queue: config.queues.invoiceGenerated,
								durable: true,
								arguments: {
									"x-dead-letter-exchange":
										config.deadLetterExchange,
									"x-dead-letter-routing-key": "failed",
								},
							},
							{
								queue: config.queues.deadLetter,
								durable: true,
							},
						],
						queueBindings: [
							{
								queue: config.queues.subscriptionRequested,
								exchange: config.exchange,
								routingKey: "subscription.requested",
							},
							{
								queue: config.queues.accountReady,
								exchange: config.exchange,
								routingKey: "account.ready",
							},
							{
								queue: config.queues.subscriptionCreated,
								exchange: config.exchange,
								routingKey: "subscription.created",
							},
							{
								queue: config.queues.invoiceGenerated,
								exchange: config.exchange,
								routingKey: "invoice.generated",
							},
							{
								queue: config.queues.deadLetter,
								exchange: config.deadLetterExchange,
								routingKey: "failed",
							},
						],
					});
				} catch (publisherError) {
					throw new RabbitMQPublishError(
						"Failed to create publisher",
						publisherError,
					);
				}
			}

			// Serialize event with error handling
			let message: string;
			try {
				message = JSON.stringify(event);
			} catch (serializationError) {
				throw new RabbitMQPublishError(
					"Failed to serialize event",
					serializationError,
				);
			}

			// Publish the message
			await this.publisher.send(
				{
					exchange: config.exchange,
					routingKey: routingKey,
				},
				message,
				{
					contentType: "application/json",
					correlationId: event.correlationId,
					messageId: event.eventId,
					timestamp: Date.now(),
					type: event.type,
					deliveryMode: 2, // Persistent
				},
			);

			console.log(
				`📤 Published event: ${event.type} (${event.eventId}) to ${routingKey}`,
			);
		} catch (error) {
			console.error("❌ Failed to publish event:", error);

			if (error instanceof RabbitMQPublishError) {
				throw error;
			}

			throw new RabbitMQPublishError(
				"Unexpected error during event publishing",
				error,
			);
		}
	}

	consume<T extends DomainEvent>(
		queueName: string,
		handler: (event: T) => Promise<void>,
		options: {
			handlerTimeoutMs?: number;
			maxRetries?: number;
		} = {},
	): void {
		// Validate inputs
		if (!queueName?.trim()) {
			throw new RabbitMQConsumerError("Queue name cannot be empty");
		}

		if (!handler || typeof handler !== "function") {
			throw new RabbitMQConsumerError("Handler must be a valid function");
		}

		// Store consumer configuration for auto-resume after reconnection
		const existingConfigIndex = this.consumerConfigs.findIndex(
			(c) => c.queueName === queueName,
		);
		if (existingConfigIndex === -1) {
			this.consumerConfigs.push({ queueName, handler, options });
			console.log(
				`📝 Registered consumer configuration for queue: ${queueName}`,
			);
		}

		// Create the consumer if currently connected
		if (this.connectionState === ConnectionState.CONNECTED) {
			this._createConsumer(queueName, handler, options);
		} else {
			console.log(
				`⏸️ Consumer for ${queueName} registered, will be created when connection is established`,
			);
		}
	}

	private _createConsumer<T extends DomainEvent>(
		queueName: string,
		handler: (event: T) => Promise<void>,
		options: {
			handlerTimeoutMs?: number;
			maxRetries?: number;
		} = {},
	): void {
		const handlerTimeoutMs = options.handlerTimeoutMs ?? 30000;
		const maxRetries = options.maxRetries ?? config.retry.maxRetries;

		try {
			console.log(`🔄 Starting consumer for queue: ${queueName}`);

			if (this.connectionState !== ConnectionState.CONNECTED) {
				throw new RabbitMQConsumerError(
					"RabbitMQ connection not established",
				);
			}

			if (!this.connection) {
				throw new RabbitMQConsumerError("RabbitMQ connection is null");
			}

			this.consumer = this.connection.createConsumer(
				{
					queue: queueName,
					queueOptions: {
						durable: true,
						arguments: {
							"x-dead-letter-exchange": config.deadLetterExchange,
							"x-dead-letter-routing-key": "failed",
						},
					},
					// Prefetch 1 message at a time
					qos: { prefetchCount: 1 },
				},
				async (message) => {
					// Get retry count from headers
					const retryCount =
						(message.headers?.["x-retry-count"] as number) || 0;
					let event: T | null = null;

					try {
						// Validate message
						if (!message?.body) {
							console.error("❌ Received empty message body");
							return; // ACK - don't retry invalid messages
						}

						// Parse event with error handling
						try {
							event = JSON.parse(message.body) as T;
						} catch (parseError) {
							console.error(
								"❌ Failed to parse event JSON:",
								parseError,
							);
							return; // ACK - don't retry unparseable messages
						}

						// Validate event structure
						if (!event?.eventId || !event?.type) {
							console.error(
								"❌ Invalid event structure: missing eventId or type",
							);
							return; // ACK - don't retry invalid messages
						}

						console.log(
							`📥 Received event: ${event.type} (${event.eventId}) [retry: ${retryCount}/${maxRetries}]`,
						);

						// Process the event with timeout
						let timeoutId: ReturnType<typeof setTimeout>;
						const timeoutPromise = new Promise<never>(
							(_, reject) => {
								timeoutId = setTimeout(
									() =>
										reject(
											new Error(
												`Handler timeout after ${handlerTimeoutMs}ms`,
											),
										),
									handlerTimeoutMs,
								);
							},
						);

						try {
							await Promise.race([
								handler(event),
								timeoutPromise,
							]);
						} finally {
							clearTimeout(timeoutId!);
						}

						console.log(
							`✅ Processed event: ${event.type} (${event.eventId})`,
						);
					} catch (handlerError) {
						const errorClassification = classifyError(handlerError);
						const eventInfo = event
							? `${event.type} (${event.eventId})`
							: "unknown event";

						console.error(
							`❌ Handler failed for event ${eventInfo}:`,
							{
								error: handlerError instanceof Error
									? handlerError.message
									: String(handlerError),
								errorType: errorClassification.type,
								errorCode: errorClassification.code,
								retryable: errorClassification.retryable,
								retryCount,
								maxRetries,
							},
						);

						// Check if we should retry
						if (
							errorClassification.retryable &&
							retryCount < maxRetries
						) {
							console.log(
								`🔄 Scheduling retry ${
									retryCount + 1
								}/${maxRetries} for event ${eventInfo}`,
							);

							// Republish with incremented retry count
							if (event && this.publisher) {
								const delay = Math.min(
									config.retry.baseDelayMs *
										Math.pow(2, retryCount),
									config.retry.maxDelayMs,
								);

								// Wait before republishing
								await new Promise((resolve) =>
									setTimeout(resolve, delay)
								);

								try {
									await this.publisher.send(
										{
											exchange: config.exchange,
											routingKey: this
												.getRoutingKeyForQueue(
													queueName,
												),
										},
										message.body,
										{
											contentType: "application/json",
											correlationId: event.correlationId,
											messageId:
												`${event.eventId}-retry-${
													retryCount + 1
												}`,
											timestamp: Date.now(),
											type: event.type,
											deliveryMode: 2,
											headers: {
												"x-retry-count": retryCount + 1,
												"x-original-event-id":
													event.eventId,
												"x-last-error":
													handlerError instanceof
															Error
														? handlerError.message
														: String(handlerError),
												"x-error-type":
													errorClassification.type,
												"x-error-code":
													errorClassification.code,
											},
										},
									);
									console.log(
										`📤 Republished event for retry: ${eventInfo}`,
									);
								} catch (republishError) {
									console.error(
										`❌ Failed to republish event for retry: ${eventInfo}`,
										republishError,
									);
									// Message will be nacked and go to DLQ
									throw handlerError;
								}
							}
						} else {
							// Max retries exceeded or non-retryable error
							console.error(
								`💀 Event ${eventInfo} sent to dead letter queue after ${retryCount} retries. Reason: ${
									errorClassification.retryable
										? "max retries exceeded"
										: "non-retryable error"
								}`,
							);
							// Re-throw to nack the message and send to DLQ
							throw handlerError;
						}
					}
				},
			);

			console.log(
				`✅ Consumer for queue ${queueName} is ready and listening`,
			);

			// Set up consumer error handling
			this.consumer.on("error", (error: unknown) => {
				console.error(
					`❌ Consumer error for ${queueName}:`,
					error,
				);
				// Consider reconnection logic here
			});
		} catch (error) {
			console.error(
				`❌ Failed to setup consumer for ${queueName}:`,
				error,
			);

			if (error instanceof RabbitMQConsumerError) {
				throw error;
			}

			throw new RabbitMQConsumerError(
				`Failed to setup consumer for ${queueName}`,
				error,
			);
		}
	}

	/**
	 * Recreate all registered consumers after reconnection
	 */
	private recreateAllConsumers(): void {
		if (this.consumerConfigs.length === 0) {
			return;
		}

		console.log(
			`🔄 Recreating ${this.consumerConfigs.length} consumer(s)...`,
		);

		for (const config of this.consumerConfigs) {
			try {
				this._createConsumer(
					config.queueName,
					config.handler,
					config.options,
				);
				console.log(
					`✅ Recreated consumer for queue: ${config.queueName}`,
				);
			} catch (error) {
				console.error(
					`❌ Failed to recreate consumer for ${config.queueName}:`,
					error,
				);
			}
		}
	}

	/**
	 * Get routing key for a given queue name
	 */
	private getRoutingKeyForQueue(queueName: string): string {
		const routingKeyMap: Record<string, string> = {
			[config.queues.subscriptionRequested]: "subscription.requested",
			[config.queues.accountReady]: "account.ready",
			[config.queues.subscriptionCreated]: "subscription.created",
			[config.queues.invoiceGenerated]: "invoice.generated",
		};
		return routingKeyMap[queueName] || queueName;
	}

	async disconnect(): Promise<void> {
		const errors: Error[] = [];

		try {
			// Clear reconnection timeout
			if (this.reconnectTimeout) {
				clearTimeout(this.reconnectTimeout);
				this.reconnectTimeout = null;
			}

			// Close consumer
			if (this.consumer) {
				try {
					await this.consumer.close();
					console.log("✅ Consumer closed");
				} catch (error) {
					console.error("❌ Error closing consumer:", error);
					errors.push(
						new Error("Failed to close consumer", { cause: error }),
					);
				} finally {
					this.consumer = null;
				}
			}

			// Close publisher
			if (this.publisher) {
				try {
					await this.publisher.close();
					console.log("✅ Publisher closed");
				} catch (error) {
					console.error("❌ Error closing publisher:", error);
					errors.push(
						new Error("Failed to close publisher", {
							cause: error,
						}),
					);
				} finally {
					this.publisher = null;
				}
			}

			// Close connection
			if (this.connection) {
				try {
					await this.connection.close();
					console.log("✅ Connection closed");
				} catch (error) {
					console.error("❌ Error closing connection:", error);
					errors.push(
						new Error("Failed to close connection", {
							cause: error,
						}),
					);
				} finally {
					this.connection = null;
				}
			}

			// Reset state
			this.connectionState = ConnectionState.DISCONNECTED;
			this.connectionRetries = 0;
			this.reconnectDelay = 1000;
			// Clear consumer configurations on explicit disconnect
			this.consumerConfigs = [];

			if (errors.length === 0) {
				console.log("🔌 Successfully disconnected from RabbitMQ");
			} else {
				console.warn(
					`⚠️ Disconnected from RabbitMQ with ${errors.length} error(s)`,
				);
				// Log errors but don't throw to ensure cleanup completes
				errors.forEach((error) =>
					console.error("Disconnect error:", error)
				);
			}
		} catch (error) {
			console.error("❌ Unexpected error during disconnect:", error);
			// Still reset state even if unexpected error occurs
			this.connectionState = ConnectionState.DISCONNECTED;
			this.connection = null;
			this.publisher = null;
			this.consumer = null;
		}
	}

	// Add method to get current connection state
	getConnectionState(): ConnectionState {
		return this.connectionState;
	}

	// Add method to check if connected
	isConnected(): boolean {
		return this.connectionState === ConnectionState.CONNECTED &&
			this.connection !== null;
	}
}
// Generic event publisher for serverless functions
export async function publishEvent(
	routingKey: string,
	event: DomainEvent,
	connectionFactory?: ConnectionFactory,
): Promise<void> {
	if (!routingKey?.trim()) {
		throw new RabbitMQPublishError("Routing key cannot be empty");
	}

	if (!event) {
		throw new RabbitMQPublishError("Event cannot be null or undefined");
	}

	const client = new RabbitMQClient(connectionFactory);
	try {
		// Wait for connection to be established
		await client.connect();

		// Verify connection before publishing
		if (!client.isConnected()) {
			throw new RabbitMQPublishError("Failed to establish connection");
		}

		await client.publishEvent(routingKey, event);
	} catch (error) {
		console.error("❌ Error in publishEvent:", error);

		if (
			error instanceof RabbitMQPublishError ||
			error instanceof RabbitMQConnectionError
		) {
			throw error;
		}

		throw new RabbitMQPublishError(
			"Unexpected error during event publishing",
			error,
		);
	} finally {
		// Always close the connection to prevent event loop escaping
		try {
			await client.disconnect();
		} catch (disconnectError) {
			console.error(
				"❌ Error during cleanup disconnect:",
				disconnectError,
			);
			// Don't throw here to avoid masking the original error
		}
	}
}

// Singleton client for long-running consumers (not recommended for serverless)
let globalClient: RabbitMQClient | null = null;

export async function getGlobalRabbitMQClient(
	connectionFactory?: ConnectionFactory,
): Promise<RabbitMQClient> {
	try {
		if (!globalClient) {
			globalClient = new RabbitMQClient(connectionFactory);
			await globalClient.connect();
		} else if (!globalClient.isConnected()) {
			// Reconnect if connection was lost
			console.log("🔄 Reconnecting global RabbitMQ client...");
			await globalClient.connect();
		}
		return globalClient;
	} catch (error) {
		console.error("❌ Failed to get global RabbitMQ client:", error);
		// Reset global client on error
		globalClient = null;
		throw new RabbitMQConnectionError(
			"Failed to establish global RabbitMQ connection",
			error,
		);
	}
}

export async function closeGlobalRabbitMQClient(): Promise<void> {
	if (globalClient) {
		try {
			await globalClient.disconnect();
			console.log("✅ Global RabbitMQ client closed");
		} catch (error) {
			console.error("❌ Error closing global RabbitMQ client:", error);
		} finally {
			globalClient = null;
		}
	}
}
