/**
 * HTTP 访问封装：统一错误结构、401 会话失效处理。
 * 错误体为 { code, message }；message 为服务端中文文案，可直接展示。
 */
import type { ApiErrorBody } from "#shared/types/api";

/** 会话失效时的全局处理，由插件在启动时注册 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const err = error as {
    data?: ApiErrorBody | string;
    statusCode?: number;
    status?: number;
    message?: string;
  };
  const status = err?.statusCode ?? err?.status ?? 0;
  const data = err?.data;
  if (data && typeof data === "object" && typeof data.code === "string") {
    return new ApiError(data.code, data.message ?? "请求失败", status);
  }
  if (!status) {
    return new ApiError("NETWORK", "网络连接失败，请检查网络后重试", status);
  }
  return new ApiError("INTERNAL", err?.message ?? "请求失败", status);
}

/** 发起同源 JSON 请求；401 时触发会话失效处理（回加入页） */
export async function apiFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
    query?: Record<string, string | number | undefined>;
  } = {},
): Promise<T> {
  try {
    // 浏览器对写请求自动携带同源 Origin，满足服务端来源校验
    return (await $fetch(path, {
      method: options.method ?? "GET",
      body: options.body,
      query: options.query,
    })) as T;
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status === 401) {
      onUnauthorized?.();
    }
    throw apiError;
  }
}

/** 附件访问地址（img src / 下载链接）；download=1 强制下载 */
export function attachmentUrl(attachmentId: string, download = false): string {
  return `/api/attachments/${attachmentId}${download ? "?download=1" : ""}`;
}
