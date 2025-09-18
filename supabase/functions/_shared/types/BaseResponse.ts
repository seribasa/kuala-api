export type BaseResponse<T> = {
    is_successful: boolean;
    message: string;
    data?: T;
};

export type ErrorResponse = {
    code: string;
    message: string;
    details?: string;
};
