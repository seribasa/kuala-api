import { AccountService } from "./account-service.ts";
export { AccountService };

const accountService = new AccountService();

// Auto-start the service
accountService.start().catch(console.error);

// Graceful shutdown
globalThis.addEventListener("unload", () => {
	accountService.stop();
});

// Start HTTP server for health checks
Deno.serve({ port: 8001 }, (_req) => {
	const status = accountService.getStatus();
	return new Response(JSON.stringify(status), {
		headers: { "content-type": "application/json" },
	});
});
