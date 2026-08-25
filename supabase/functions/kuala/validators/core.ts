import { zValidator } from "@hono/zod-validator";
import { ErrorResponse } from "../../_shared/types/response.ts";
import { ZodType } from "zod";
import { Context, Next } from "@hono/hono";

export const validateJson = <T>(schema: ZodType<T>) => {
	return async (c: Context, next: Next) => {
		let body = {};
		const contentType = c.req.header("content-type");

		try {
			if (contentType && contentType.includes("application/json")) {
				const text = await c.req.text();
				if (text && text.trim().length > 0) {
					body = JSON.parse(text);
				}
			}
		} catch (error) {
			const errorResponse: ErrorResponse = {
				code: "INVALID_REQUEST",
				message: "Malformed JSON in request body",
			};
			return c.json(errorResponse, 400);
		}

		const result = await schema.safeParseAsync(body);

		if (!result.success) {
			// deno-lint-ignore no-explicit-any
			const error = result.error as any;
			const errorResponse: ErrorResponse = {
				code: "INVALID_REQUEST",
				message: error.errors?.[0]?.message || "Validation error",
				details: error.format?.(),
			};
			return c.json(errorResponse, 400);
		}

		// Set the valid value in the context for type inference
		// deno-lint-ignore no-explicit-any
		c.req.addValidatedData("json" as any, result.data as any);

		await next();
	};
};

export const validateQuery = <T>(schema: ZodType<T>) => {
	return zValidator("query", schema, (result, c) => {
		if (!result.success) {
			// deno-lint-ignore no-explicit-any
			const error = result.error as any;
			const errorResponse: ErrorResponse = {
				code: "INVALID_REQUEST",
				message: error.errors?.[0]?.message || "Validation error",
				details: error.format?.(),
			};
			return c.json(errorResponse, 400);
		}
	});
};

export const validateParam = <T>(schema: ZodType<T>) => {
	return zValidator("param", schema, (result, c) => {
		if (!result.success) {
			// deno-lint-ignore no-explicit-any
			const error = result.error as any;
			const errorResponse: ErrorResponse = {
				code: "INVALID_REQUEST",
				message: error.errors?.[0]?.message || "Validation error",
				details: error.format?.(),
			};
			return c.json(errorResponse, 400);
		}
	});
};
