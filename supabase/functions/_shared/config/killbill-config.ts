import { config } from "../../_shared/config/env.ts";
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
		baseUrl: config.KILLBILL_BASE_URL,
		apiKey: config.KILLBILL_API_KEY,
		apiSecret: config.KILLBILL_API_SECRET,
		username: config.KILLBILL_USERNAME,
		password: config.KILLBILL_PASSWORD,
		defaultCurrency: config.KILLBILL_DEFAULT_CURRENCY,
	};
}

export { killBillConfig };
export type { KillBillConfig };
