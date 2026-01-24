// Mock RabbitMQ client for testing
// This mock is used in place of the real rabbitmq-client during tests

export class MockConnection {
	private errorHandler: ((err: Error) => void) | null = null;
	private connectionHandler: (() => void | Promise<void>) | null = null;
	public shouldFailConnection = false;
	public shouldDelayConnection = false;

	// deno-lint-ignore no-explicit-any
	on(event: string, handler: (arg?: any) => void | Promise<void>) {
		if (event === "error") {
			this.errorHandler = handler as (err: Error) => void;
		} else if (event === "connection") {
			this.connectionHandler = handler as () => void | Promise<void>;
			// Simulate immediate connection if not failing
			if (!this.shouldFailConnection && !this.shouldDelayConnection) {
				setTimeout(() => this.triggerConnection(), 10);
			}
		}
	}

	triggerError(error: Error) {
		if (this.errorHandler) {
			this.errorHandler(error);
		}
	}

	async triggerConnection() {
		if (this.connectionHandler) {
			await this.connectionHandler();
		}
	}

	// deno-lint-ignore no-explicit-any
	createPublisher(_options: any) {
		return {
			send: async () => {},
			close: async () => {},
		};
	}

	// deno-lint-ignore no-explicit-any
	createConsumer(_options: any, handler: (message: any) => Promise<void>) {
		return {
			on: () => {},
			close: async () => {},
			_handler: handler, // Expose for testing
		};
	}

	async close() {}
}

// Export as Connection to match the real module
export const Connection = MockConnection;
