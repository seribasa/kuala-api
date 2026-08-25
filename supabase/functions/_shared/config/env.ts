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

const baseConfig = typeof Deno !== "undefined" ? Deno.env.toObject() : {};
const parsed = envSchema.safeParse(baseConfig);
if (!parsed.success) {
	console.error(
		"❌ Invalid environment configuration:",
		parsed.error.format(),
	);
}
const fallbackConfig = parsed.success ? parsed.data : {} as EnvConfig;

export const config = new Proxy(fallbackConfig, {
	get(target, prop) {
		if (typeof prop === "string" && prop in envSchema.shape) {
			const shapeProp = prop as keyof typeof envSchema.shape;
			if (typeof Deno !== "undefined") {
				try {
					const dynamicVal = Deno.env.get(prop);
					return envSchema.shape[shapeProp].parse(dynamicVal);
				} catch (e) {
					// Fallback if parsing fails (e.g. invalid URL)
					return target[shapeProp as keyof typeof target];
				}
			}
		}
		return target[prop as keyof typeof target];
	},
}) as EnvConfig;

export function overrideConfig(overrides: Partial<EnvConfig>) {
	Object.assign(fallbackConfig, overrides);
}

export function resetConfig() {
	if (parsed.success) {
		Object.assign(fallbackConfig, parsed.data);
	}
}
