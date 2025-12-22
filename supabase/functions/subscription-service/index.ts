import { SubscriptionService } from "./subscription-service.ts";

const subscriptionService = new SubscriptionService();

// Auto-start the service
subscriptionService.start().catch(console.error);

// Graceful shutdown
globalThis.addEventListener("unload", () => {
	subscriptionService.stop().catch(console.error);
});
