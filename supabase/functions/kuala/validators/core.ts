import { zValidator } from "@hono/zod-validator";
import { ErrorResponse } from "../../_shared/types/response.ts";
import { ZodType } from "zod";

export const validateJson = <T>(schema: ZodType<T>) => {
	return zValidator("json", schema, (result, c) => {
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
