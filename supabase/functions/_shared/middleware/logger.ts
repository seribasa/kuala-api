/**
 * Custom logger middleware for Kuala API
 * Provides structured logging following Hono's PrintFunc pattern
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogContext {
	timestamp: string;
	level: LogLevel;
	handler?: string;
	requestId?: string;
	operation?: string;
}

export type LogData = Record<
	string,
	string | number | boolean | undefined | null
>;

/**
 * Custom logger function following Hono's PrintFunc pattern
 * @param message - Main log message
 * @param rest - Additional context data
 */
export const customLogger = (message: string, ...rest: string[]) => {
	const timestamp = new Date().toISOString();
	console.log(`[${timestamp}] ${message}`, ...rest);
};

/**
 * Structured logger for application events
 * @param level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param handler - Handler name (e.g., 'authorize', 'exchange-token')
 * @param operation - Operation description
 * @param data - Additional data to log
 */
export const log = (
	level: LogLevel,
	handler: string,
	operation: string,
	data?: LogData,
) => {
	const timestamp = new Date().toISOString();
	const prefix = `[${timestamp}] [${level}] [${handler}]`;

	if (data) {
		console.log(`${prefix} ${operation}:`, JSON.stringify(data, null, 2));
	} else {
		console.log(`${prefix} ${operation}`);
	}
};

/**
 * Convenience logging functions for different levels
 */
export const logger = {
	debug: (handler: string, operation: string, data?: LogData) =>
		log("DEBUG", handler, operation, data),

	info: (handler: string, operation: string, data?: LogData) =>
		log("INFO", handler, operation, data),

	warn: (handler: string, operation: string, data?: LogData) =>
		log("WARN", handler, operation, data),

	error: (handler: string, operation: string, data?: LogData) =>
		log("ERROR", handler, operation, data),
};

/**
 * Logger for authentication operations with enhanced context
 */
export const authLogger = {
	start: (handler: string, data?: LogData) =>
		logger.info(handler, "Starting request", data),

	validation: (handler: string, operation: string, data?: LogData) =>
		logger.debug(handler, `Validation: ${operation}`, data),

	apiCall: (handler: string, operation: string, data?: LogData) =>
		logger.debug(handler, `API Call: ${operation}`, data),

	success: (handler: string, operation: string, data?: LogData) =>
		logger.info(handler, `Success: ${operation}`, data),

	error: (handler: string, operation: string, data?: LogData) =>
		logger.error(handler, `Error: ${operation}`, data),

	exception: (handler: string, error: Error) =>
		logger.error(handler, "Exception caught", {
			name: error.name,
			message: error.message,
			stack: error.stack?.split("\n").slice(0, 3).join("; "),
		}),
};
