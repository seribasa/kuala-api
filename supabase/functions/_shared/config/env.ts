import { z } from "zod";

const envSchema = z.object({
	DENO_ENV: z.enum(["development", "test", "staging", "production"]).default(
		"development",
	),
	SUPABASE_URL: z.string().url().optional(),
	SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
	AUTH_BASE_URL: z.string().url().optional(),
	AUTH_SUPABASE_ANON_KEY: z.string().optional(),
	CORS_ENABLED: z.string().transform((v) => v.toLowerCase() !== "false")
		.default(true),
	CORS_ORIGIN: z.string().default("*"),
	KILLBILL_BASE_URL: z.string().optional().default(""),
	KILLBILL_API_KEY: z.string().optional().default(""),
	KILLBILL_API_SECRET: z.string().optional().default(""),
	KILLBILL_USERNAME: z.string().optional().default(""),
	KILLBILL_PASSWORD: z.string().optional().default(""),
	KILLBILL_DEFAULT_CURRENCY: z.string().optional().default(""),
	PAYMENT_GATEWAY: z.string().optional(),
	BAYEU_API_URL: z.string().url().optional(),
	BAYEU_ANON_KEY: z.string().optional(),
	ENTERPRISE_CONTACT_EMAIL: z.string().optional().default(""),
	ENTERPRISE_CONTACT_PHONE: z.string().optional().default(""),
	ENTERPRISE_CONTACT_MESSAGE: z.string().optional().default(""),
	OUTPOST_WEBHOOK_SECRET: z.string().optional(),
	SKIP_WEBHOOK_VERIFICATION: z.string().transform((v) => v === "true")
		.default(false),
	RABBITMQ_URL: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
	const env = typeof Deno !== "undefined" ? Deno.env.toObject() : {};
	const result = envSchema.safeParse(env);
	if (!result.success) {
		console.error(
			"❌ Invalid environment configuration:",
			z.treeifyError(result.error),
		);
		throw new Error("Invalid config");
	}
	return result.data;
}

export const initialConfig = loadConfig();
export const config = { ...initialConfig };

export function overrideConfig(overrides: Partial<EnvConfig>) {
	Object.assign(config, overrides);
}

export function resetConfig() {
	for (const key of Object.keys(config) as (keyof EnvConfig)[]) {
		// @ts-ignore dynamic
		config[key] = initialConfig[key];
	}
}
