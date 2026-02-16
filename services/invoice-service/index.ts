import { InvoiceService } from "./invoice-service.ts";
export { InvoiceService };

const invoiceService = new InvoiceService();

// Auto-start the services
invoiceService.start().catch(console.error);

// Graceful shutdown
globalThis.addEventListener("unload", () => {
	invoiceService.stop();
});

// Start HTTP server for health checks
Deno.serve({ port: 8002 }, (_req) => {
	const status = invoiceService.getStatus();
	return new Response(JSON.stringify(status), {
		headers: { "content-type": "application/json" },
	});
});
