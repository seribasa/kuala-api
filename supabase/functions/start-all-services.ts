#!/usr/bin/env deno

/**
 * Script to start all microservices concurrently
 * Usage: deno run --allow-all start-all-services.ts
 */

import { AccountService } from "./account-service/account-service.ts";
import { InvoiceService } from "./invoice-service/invoice-service.ts";
import { SubscriptionService } from "./subscription-service/subscription-service.ts";
import process from "node:process";

class ServiceOrchestrator {
	private services: {
		account: AccountService;
		invoice: InvoiceService;
		subscription: SubscriptionService;
	};

	constructor() {
		this.services = {
			account: new AccountService(),
			invoice: new InvoiceService(),
			subscription: new SubscriptionService(),
		};
	}

	async start() {
		console.log("🚀 Starting all microservices...");

		try {
			// Start all services concurrently
			await Promise.all([
				this.startService("Account", this.services.account),
				this.startService("Invoice", this.services.invoice),
				this.startService("Subscription", this.services.subscription),
			]);

			console.log("✅ All services started successfully!");
			console.log("📋 Service Status:");
			console.log("  - Account Service: ✅ Running");
			console.log("  - Invoice Service: ✅ Running");
			console.log("  - Subscription Service: ✅ Running");
		} catch (error) {
			console.error("❌ Failed to start one or more services:", error);
			await this.stop();
			Deno.exit(1);
		}
	}

	// deno-lint-ignore no-explicit-any
	private async startService(name: string, service: any) {
		try {
			console.log(`🔄 Starting ${name} Service...`);
			await service.start();
			console.log(`✅ ${name} Service started`);
		} catch (error) {
			console.error(`❌ Failed to start ${name} Service:`, error);
			throw error;
		}
	}

	async stop() {
		console.log("🛑 Stopping all services...");

		const stopPromises = [
			this.stopService("Account", this.services.account),
			this.stopService("Invoice", this.services.invoice),
			this.stopService("Subscription", this.services.subscription),
		];

		try {
			await Promise.allSettled(stopPromises);
			console.log("✅ All services stopped");
		} catch (error) {
			console.error("❌ Error stopping services:", error);
		}
	}

	// deno-lint-ignore no-explicit-any
	private async stopService(name: string, service: any) {
		try {
			console.log(`🔄 Stopping ${name} Service...`);
			await service.stop();
			console.log(`✅ ${name} Service stopped`);
		} catch (error) {
			console.error(`❌ Error stopping ${name} Service:`, error);
		}
	}

	getServiceStatus() {
		return {
			account: this.services.account.getStatus?.() ||
				{ status: "unknown" },
			invoice: this.services.invoice.getStatus?.() ||
				{ status: "unknown" },
			subscription: this.services.subscription.getStatus?.() ||
				{ status: "unknown" },
		};
	}
}

// Create orchestrator instance
const orchestrator = new ServiceOrchestrator();

// Handle graceful shutdown
const shutdown = async () => {
	console.log("\n🔄 Received shutdown signal...");
	await orchestrator.stop();
	Deno.exit(0);
};

// Listen for shutdown signals
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Handle unload event (for compatibility)
globalThis.addEventListener("unload", () => {
	orchestrator.stop().catch(console.error);
});

// Start all services
if (import.meta.main) {
	orchestrator.start().catch((error) => {
		console.error("❌ Failed to start services:", error);
		Deno.exit(1);
	});

	// Keep the process running
	console.log("🔧 Services are running. Press Ctrl+C to stop.");

	// Optional: Set up a basic health check endpoint or status monitoring
	setInterval(() => {
		const status = orchestrator.getServiceStatus();
		// deno-lint-ignore no-unused-vars
		const healthCheck = {
			timestamp: new Date().toISOString(),
			services: status,
			uptime: Math.floor(process.uptime?.() || 0),
		};

		// You could log this or expose it via HTTP endpoint
		// console.log("📊 Health Check:", healthCheck);
	}, 30000); // Check every 30 seconds
}

export { ServiceOrchestrator };
