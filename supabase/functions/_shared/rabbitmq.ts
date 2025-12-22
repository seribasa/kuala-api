// RabbitMQ Connection and Event Handling for Supabase Edge Functions
import { Connection } from "rabbitmq-client";
import { DomainEvent } from "./types/events.ts";

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
	queues: {
		subscriptionRequested: string;
		accountReady: string;
		subscriptionCreated: string;
		invoiceGenerated: string;
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
	queues: {
		subscriptionRequested: "subscription-requested",
		accountReady: "account-ready",
		subscriptionCreated: "subscription-created",
		invoiceGenerated: "invoice-generated",
	},
};

export class RabbitMQClient {
	private connection: Connection | null = null;
	// deno-lint-ignore no-explicit-any
	private publisher: any | null = null;
	// deno-lint-ignore no-explicit-any
	private consumer: any | null = null;
	private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
	private maxRetries = 3;
	private connectionRetries = 0;
	private reconnectDelay = 1000; // Start with 1 second
	private maxReconnectDelay = 30000; // Max 30 seconds
	private reconnectTimeout: number | null = null;

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
				}/${this.maxRetries + 1})...`,
			);

			const rabbitmq = new Connection(config.url);

			// Set up connection event handlers
			rabbitmq.on("error", (err) => {
				console.error("❌ RabbitMQ connection error:", err);
				this.connectionState = ConnectionState.ERROR;
				this.connection = null;
				this.scheduleReconnect();
			});

			rabbitmq.on("connection", () => {
				console.log("✅ RabbitMQ connection established");
				this.connectionState = ConnectionState.CONNECTED;
				this.connection = rabbitmq;
				this.connectionRetries = 0;
				this.reconnectDelay = 1000; // Reset delay
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
		if (this.connectionRetries >= this.maxRetries) {
			console.error(
				`❌ Max reconnection attempts (${this.maxRetries}) exceeded`,
			);
			return;
		}

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}

		this.connectionRetries++;
		const delay = Math.min(
			this.reconnectDelay * Math.pow(2, this.connectionRetries - 1),
			this.maxReconnectDelay,
		);

		console.log(
			`🔄 Scheduling reconnection in ${delay}ms (attempt ${this.connectionRetries}/${this.maxRetries})`,
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
				reject(new RabbitMQConnectionError("Connection timeout"));
			}, timeoutMs);

			const checkConnection = () => {
				if (this.connectionState === ConnectionState.CONNECTED) {
					clearTimeout(timeout);
					resolve();
				} else if (this.connectionState === ConnectionState.ERROR) {
					clearTimeout(timeout);
					reject(new RabbitMQConnectionError("Connection failed"));
				} else {
					setTimeout(checkConnection, 100);
				}
			};

			checkConnection();
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
						maxAttempts: this.maxRetries,
						// Declare queues and exchanges
						confirm: true,
						exchanges: [{
							exchange: config.exchange,
							type: "topic",
							durable: true,
						}],
						queues: [
							{
								queue: config.queues.subscriptionRequested,
								durable: true,
							},
							{
								queue: config.queues.accountReady,
								durable: true,
							},
							{
								queue: config.queues.subscriptionCreated,
								durable: true,
							},
							{
								queue: config.queues.invoiceGenerated,
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
	): void {
		// Validate inputs
		if (!queueName?.trim()) {
			throw new RabbitMQConsumerError("Queue name cannot be empty");
		}

		if (!handler || typeof handler !== "function") {
			throw new RabbitMQConsumerError("Handler must be a valid function");
		}

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
					queueOptions: { durable: true },
					// Prefetch 1 message at a time
					qos: { prefetchCount: 1 },
				},
				async (message) => {
					try {
						// Validate message
						if (!message?.body) {
							console.error("❌ Received empty message body");
							return;
						}

						// Parse event with error handling
						let event: T;
						try {
							event = JSON.parse(message.body) as T;
						} catch (parseError) {
							console.error(
								"❌ Failed to parse event JSON:",
								parseError,
							);
							return;
						}

						// Validate event structure
						if (!event?.eventId || !event?.type) {
							console.error(
								"❌ Invalid event structure: missing eventId or type",
							);
							return;
						}

						console.log(
							`📥 Received event: ${event.type} (${event.eventId})`,
						);

						// Process the event with timeout
						try {
							const timeoutPromise = new Promise<never>(
								(_, reject) => {
									setTimeout(
										() =>
											reject(
												new Error("Handler timeout"),
											),
										30000,
									);
								},
							);

							await Promise.race([
								handler(event),
								timeoutPromise,
							]);

							console.log(
								`✅ Processed event: ${event.type} (${event.eventId})`,
							);
						} catch (handlerError) {
							console.error(
								`❌ Handler failed for event ${event.type} (${event.eventId}):`,
								handlerError,
							);
							// Consider implementing dead letter queue here
						}
					} catch (error) {
						console.error(
							"❌ Unexpected error processing message:",
							error,
						);
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
): Promise<void> {
	if (!routingKey?.trim()) {
		throw new RabbitMQPublishError("Routing key cannot be empty");
	}

	if (!event) {
		throw new RabbitMQPublishError("Event cannot be null or undefined");
	}

	const client = new RabbitMQClient();
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

export async function getGlobalRabbitMQClient(): Promise<RabbitMQClient> {
	try {
		if (!globalClient) {
			globalClient = new RabbitMQClient();
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
