import { InvoiceService } from "./invoice-service.ts";

const invoiceService = new InvoiceService();

// Auto-start the services
invoiceService.start().catch(console.error);

// Graceful shutdown
globalThis.addEventListener("unload", () => {
	invoiceService.stop().catch(console.error);
});
