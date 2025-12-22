import { AccountService } from "./account-service.ts";

const accountService = new AccountService();

// Auto-start the service
accountService.start().catch(console.error);

// Graceful shutdown
globalThis.addEventListener("unload", () => {
	accountService.stop().catch(console.error);
});
