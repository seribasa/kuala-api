import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { KeycloakService } from "../../_shared/services/keycloak.ts";

Deno.test("KeycloakService - resolves config from customConfig and parses realm", () => {
	const service = new KeycloakService({
		keycloakUrl: "https://identity.example.com/realms/custom-realm",
		clientId: "kuala-client",
		clientSecret: "super-secret",
	});

	assertEquals(service.isConfigured(), true);
	assertEquals(service.getBaseUrl(), "https://identity.example.com");
	assertEquals(service.getRealm(), "custom-realm");
});

Deno.test("KeycloakService - uses explicit customConfig.realm and env KEYCLOAK_REALM", () => {
	const customRealmService = new KeycloakService({
		keycloakUrl: "https://identity.example.com",
		clientId: "kuala-client",
		clientSecret: "super-secret",
		realm: "explicit-realm",
	});
	assertEquals(customRealmService.getRealm(), "explicit-realm");
	assertEquals(customRealmService.isConfigured(), true);

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KEYCLOAK_URL") return "https://identity.example.com";
		if (key === "KEYCLOAK_CLIENT_ID") return "kuala";
		if (key === "KEYCLOAK_CLIENT_SECRET") return "secret";
		if (key === "KEYCLOAK_REALM") return "env-realm";
		return undefined;
	});

	try {
		const envService = new KeycloakService();
		assertEquals(envService.getRealm(), "env-realm");
		assertEquals(envService.isConfigured(), true);
	} finally {
		envStub.restore();
	}
});

Deno.test("KeycloakService - falls back to EXTERNAL_KEYCLOAK_* env vars", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "EXTERNAL_KEYCLOAK_URL") {
			return "https://ext.example.com/realms/ext-realm";
		}
		if (key === "EXTERNAL_KEYCLOAK_CLIENT_ID") return "ext-client";
		if (key === "EXTERNAL_KEYCLOAK_SECRET") return "ext-secret";
		return undefined;
	});

	try {
		const service = new KeycloakService();
		assertEquals(service.isConfigured(), true);
		assertEquals(service.getBaseUrl(), "https://ext.example.com");
		assertEquals(service.getRealm(), "ext-realm");
	} finally {
		envStub.restore();
	}
});

Deno.test("KeycloakService - returns empty realm and isConfigured false when realm cannot be resolved", () => {
	const warnStub = stub(console, "warn");
	const envStub = stub(Deno.env, "get", () => undefined);

	try {
		const noRealmService = new KeycloakService({
			keycloakUrl: "https://identity.example.com",
			clientId: "kuala",
			clientSecret: "secret",
		});
		assertEquals(noRealmService.getRealm(), "");
		assertEquals(noRealmService.isConfigured(), false);

		const invalidUrlService = new KeycloakService({
			keycloakUrl: "not-a-valid-url",
			clientId: "kuala",
			clientSecret: "secret",
		});
		assertEquals(invalidUrlService.getBaseUrl(), "not-a-valid-url");
		assertEquals(invalidUrlService.getRealm(), "");
		assertEquals(invalidUrlService.isConfigured(), false);

		const emptyService = new KeycloakService({});
		assertEquals(emptyService.getRealm(), "");
		assertEquals(emptyService.isConfigured(), false);
	} finally {
		envStub.restore();
		warnStub.restore();
	}
});

Deno.test("KeycloakService.getServiceAccountToken - handles unconfigured, success, HTTP errors, and exceptions", async () => {
	const unconfigured = new KeycloakService({});
	assertEquals(await unconfigured.getServiceAccountToken(), null);

	const service = new KeycloakService({
		keycloakUrl: "https://identity.example.com/realms/kuala",
		clientId: "kuala",
		clientSecret: "secret",
	});

	const errorStub = stub(console, "error");
	try {
		// 1. Success with access_token
		const okFetch = stub(
			globalThis,
			"fetch",
			() =>
				Promise.resolve(
					new Response(JSON.stringify({ access_token: "tok_123" }), {
						status: 200,
					}),
				),
		);
		try {
			assertEquals(await service.getServiceAccountToken(), "tok_123");
		} finally {
			okFetch.restore();
		}

		// 2. Success without access_token field
		const emptyTokFetch = stub(
			globalThis,
			"fetch",
			() =>
				Promise.resolve(
					new Response(JSON.stringify({}), { status: 200 }),
				),
		);
		try {
			assertEquals(await service.getServiceAccountToken(), null);
		} finally {
			emptyTokFetch.restore();
		}

		// 3. Non-OK response
		const failFetch = stub(
			globalThis,
			"fetch",
			() =>
				Promise.resolve(
					new Response("Unauthorized", {
						status: 401,
						statusText: "Unauthorized",
					}),
				),
		);
		try {
			assertEquals(await service.getServiceAccountToken(), null);
		} finally {
			failFetch.restore();
		}

		// 4. Network error
		const throwFetch = stub(
			globalThis,
			"fetch",
			() => Promise.reject(new Error("Network error")),
		);
		try {
			assertEquals(await service.getServiceAccountToken(), null);
		} finally {
			throwFetch.restore();
		}
	} finally {
		errorStub.restore();
	}
});

Deno.test("KeycloakService.logoutUser - handles invalid inputs, missing token, success, HTTP error, and exceptions", async () => {
	const unconfigured = new KeycloakService({});
	assertEquals(await unconfigured.logoutUser("user-1"), false);

	const service = new KeycloakService({
		keycloakUrl: "https://identity.example.com/realms/kuala",
		clientId: "kuala",
		clientSecret: "secret",
	});
	assertEquals(await service.logoutUser(""), false);

	const errorStub = stub(console, "error");
	const warnStub = stub(console, "warn");
	try {
		// 1. Missing admin token
		const noTokFetch = stub(
			globalThis,
			"fetch",
			() => Promise.resolve(new Response("Err", { status: 500 })),
		);
		try {
			assertEquals(await service.logoutUser("user-1"), false);
		} finally {
			noTokFetch.restore();
		}

		// 2. Successful admin logout (204)
		const okFetch = stub(
			globalThis,
			"fetch",
			(input: string | URL | Request) => {
				const url = input.toString();
				if (url.includes("/protocol/openid-connect/token")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({ access_token: "admin_tok" }),
							{ status: 200 },
						),
					);
				}
				return Promise.resolve(new Response(null, { status: 204 }));
			},
		);
		try {
			assertEquals(await service.logoutUser("user-1"), true);
		} finally {
			okFetch.restore();
		}

		// 3. Admin logout returns 404
		const notFoundFetch = stub(
			globalThis,
			"fetch",
			(input: string | URL | Request) => {
				const url = input.toString();
				if (url.includes("/protocol/openid-connect/token")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({ access_token: "admin_tok" }),
							{ status: 200 },
						),
					);
				}
				return Promise.resolve(
					new Response("Not Found", { status: 404 }),
				);
			},
		);
		try {
			assertEquals(await service.logoutUser("user-1"), false);
		} finally {
			notFoundFetch.restore();
		}

		// 4. Fetch throws during admin logout call
		const throwLogoutFetch = stub(
			globalThis,
			"fetch",
			(input: string | URL | Request) => {
				const url = input.toString();
				if (url.includes("/protocol/openid-connect/token")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({ access_token: "admin_tok" }),
							{ status: 200 },
						),
					);
				}
				return Promise.reject(new Error("Connection reset"));
			},
		);
		try {
			assertEquals(await service.logoutUser("user-1"), false);
		} finally {
			throwLogoutFetch.restore();
		}
	} finally {
		errorStub.restore();
		warnStub.restore();
	}
});

Deno.test("KeycloakService.logoutWithRefreshToken - handles invalid inputs, success, HTTP error, and exceptions", async () => {
	const unconfigured = new KeycloakService({});
	assertEquals(await unconfigured.logoutWithRefreshToken("ref_1"), false);

	const service = new KeycloakService({
		keycloakUrl: "https://identity.example.com/realms/kuala",
		clientId: "kuala",
		clientSecret: "secret",
	});
	assertEquals(await service.logoutWithRefreshToken(""), false);

	const errorStub = stub(console, "error");
	try {
		const okFetch = stub(
			globalThis,
			"fetch",
			() => Promise.resolve(new Response(null, { status: 204 })),
		);
		try {
			assertEquals(await service.logoutWithRefreshToken("ref_1"), true);
		} finally {
			okFetch.restore();
		}

		const failFetch = stub(
			globalThis,
			"fetch",
			() => Promise.resolve(new Response("Bad Request", { status: 400 })),
		);
		try {
			assertEquals(await service.logoutWithRefreshToken("ref_1"), false);
		} finally {
			failFetch.restore();
		}

		const throwFetch = stub(
			globalThis,
			"fetch",
			() => Promise.reject(new Error("Network error")),
		);
		try {
			assertEquals(await service.logoutWithRefreshToken("ref_1"), false);
		} finally {
			throwFetch.restore();
		}
	} finally {
		errorStub.restore();
	}
});
