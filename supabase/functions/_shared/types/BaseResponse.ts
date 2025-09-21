export type BaseResponse<T> = {
	successful: boolean;
	message: string;
	data?: T;
};

export type ErrorResponse = {
	code: string;
	message: string;
	details?: string;
};
