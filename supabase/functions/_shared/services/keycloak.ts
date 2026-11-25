import { config } from "../config/env.ts";

export interface KeycloakConfig {
	keycloakUrl?: string;
	clientId?: string;
	clientSecret?: string;
	realm?: string;
}

export class KeycloakService {
	private customConfig?: KeycloakConfig;

	constructor(customConfig?: KeycloakConfig) {
		this.customConfig = customConfig;
	}

	public get keycloakUrl(): string {
		return (
			this.customConfig?.keycloakUrl ||
			config.KEYCLOAK_URL ||
			config.EXTERNAL_KEYCLOAK_URL ||
			(typeof Deno !== "undefined"
				? Deno.env.get("KEYCLOAK_URL") ||
					Deno.env.get("EXTERNAL_KEYCLOAK_URL")
				: "") ||
			""
		).trim();
	}

	public get clientId(): string {
		return (
			this.customConfig?.clientId ||
			config.KEYCLOAK_CLIENT_ID ||
			config.EXTERNAL_KEYCLOAK_CLIENT_ID ||
			(typeof Deno !== "undefined"
				? Deno.env.get("KEYCLOAK_CLIENT_ID") ||
					Deno.env.get("EXTERNAL_KEYCLOAK_CLIENT_ID")
				: "") ||
			""
		).trim();
	}

	public get clientSecret(): string {
		return (
			this.customConfig?.clientSecret ||
			config.KEYCLOAK_CLIENT_SECRET ||
			config.EXTERNAL_KEYCLOAK_SECRET ||
			(typeof Deno !== "undefined"
				? Deno.env.get("KEYCLOAK_CLIENT_SECRET") ||
					Deno.env.get("EXTERNAL_KEYCLOAK_SECRET")
				: "") ||
			""
		).trim();
	}

	public get realm(): string {
		if (this.customConfig?.realm) {
			return this.customConfig.realm;
		}
		if (config.KEYCLOAK_REALM) {
			return config.KEYCLOAK_REALM;
		}
		if (typeof Deno !== "undefined" && Deno.env.get("KEYCLOAK_REALM")) {
			return Deno.env.get("KEYCLOAK_REALM")!;
		}
		if (this.keycloakUrl) {
			try {
				const parsed = new URL(this.keycloakUrl);
				const match = parsed.pathname.match(/\/realms\/([^/]+)/);
				return match ? match[1] : "";
			} catch {
				return "";
			}
		}
		return "";
	}

	public isConfigured(): boolean {
		const hasCreds = !!(
			this.keycloakUrl &&
			this.clientId &&
			this.clientSecret
		);
		if (hasCreds && !this.realm) {
			console.warn(
				"[KeycloakService] Keycloak credentials are set, but realm could not be resolved from KEYCLOAK_REALM or KEYCLOAK_URL.",
			);
			return false;
		}
		return hasCreds;
	}

	public getBaseUrl(): string {
		try {
			const parsed = new URL(this.keycloakUrl);
			return parsed.origin;
		} catch {
			return this.keycloakUrl;
		}
	}

	public getRealm(): string {
		return this.realm;
	}

	/**
	 * Obtain service account access token using Client Credentials grant
	 */
	async getServiceAccountToken(): Promise<string | null> {
		if (!this.isConfigured()) {
			return null;
		}

		const tokenUrl =
			`${this.getBaseUrl()}/realms/${this.realm}/protocol/openid-connect/token`;
		const params = new URLSearchParams();
		params.set("grant_type", "client_credentials");
		params.set("client_id", this.clientId);
		params.set("client_secret", this.clientSecret);

		try {
			const res = await fetch(tokenUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: params.toString(),
			});

			if (!res.ok) {
				console.error(
					`[KeycloakService] Failed to obtain token: ${res.status} ${res.statusText}`,
				);
				return null;
			}

			const data = await res.json();
			return data.access_token || null;
		} catch (err) {
			console.error(
				"[KeycloakService] Error fetching client credentials token:",
				err,
			);
			return null;
		}
	}

	/**
	 * Log out a user by ID using Keycloak Admin REST API
	 * POST /admin/realms/{realm}/users/{id}/logout
	 */
	async logoutUser(keycloakUserId: string): Promise<boolean> {
		if (!this.isConfigured() || !keycloakUserId) {
			return false;
		}

		const adminToken = await this.getServiceAccountToken();
		if (!adminToken) {
			console.error(
				"[KeycloakService] Cannot logout user: missing admin token",
			);
			return false;
		}

		const logoutUrl =
			`${this.getBaseUrl()}/admin/realms/${this.realm}/users/${keycloakUserId}/logout`;
		try {
			const res = await fetch(logoutUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			});

			if (res.ok || res.status === 204) {
				return true;
			}

			console.warn(
				`[KeycloakService] Admin logout returned status ${res.status}`,
			);
			return false;
		} catch (err) {
			console.error(
				"[KeycloakService] Error calling Keycloak admin logout:",
				err,
			);
			return false;
		}
	}

	/**
	 * Back-channel logout using a refresh token (OIDC standard)
	 * POST /realms/{realm}/protocol/openid-connect/logout
	 */
	async logoutWithRefreshToken(refreshToken: string): Promise<boolean> {
		if (!this.isConfigured() || !refreshToken) {
			return false;
		}

		const logoutUrl =
			`${this.getBaseUrl()}/realms/${this.realm}/protocol/openid-connect/logout`;
		const params = new URLSearchParams();
		params.set("client_id", this.clientId);
		params.set("client_secret", this.clientSecret);
		params.set("refresh_token", refreshToken);

		try {
			const res = await fetch(logoutUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: params.toString(),
			});

			return res.ok || res.status === 204;
		} catch (err) {
			console.error(
				"[KeycloakService] Error calling OIDC logout with refresh token:",
				err,
			);
			return false;
		}
	}
}

export const keycloakService = new KeycloakService();
