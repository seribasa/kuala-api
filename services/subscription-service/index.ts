import { SubscriptionService } from "./subscription-service.ts";
export { SubscriptionService };

const subscriptionService = new SubscriptionService();

// Auto-start the service
subscriptionService.start().catch(console.error);

// Graceful shutdown
globalThis.addEventListener("unload", () => {
	subscriptionService.stop();
});

// Start HTTP server for health checks
Deno.serve({ port: 8003 }, (_req) => {
	const status = subscriptionService.getStatus();
	return new Response(JSON.stringify(status), {
		headers: { "content-type": "application/json" },
	});
});
