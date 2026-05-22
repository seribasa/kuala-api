type KillBillConfig = {
	baseUrl: string;
	apiKey: string;
	apiSecret: string;
	username: string;
	password: string;
	defaultCurrency: string;
};

function killBillConfig(): KillBillConfig {
	return {
		baseUrl: Deno.env.get("KILLBILL_BASE_URL") || "http://localhost:8080",
		apiKey: Deno.env.get("KILLBILL_API_KEY") || "",
		apiSecret: Deno.env.get("KILLBILL_API_SECRET") || "",
		username: Deno.env.get("KILLBILL_USERNAME") || "",
		password: Deno.env.get("KILLBILL_PASSWORD") || "",
		defaultCurrency: Deno.env.get("KILLBILL_DEFAULT_CURRENCY") || "",
	};
}

export { killBillConfig };
export type { KillBillConfig };
