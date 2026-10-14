/**
 * `ai` 包类型垫片：@nuxt/ui 的 Chat* 组件类型从 'ai' import type，
 * 但本项目不使用 AI SDK 运行时能力，也不引入该依赖。
 * 此处按 ai v6 的最小类型面声明，仅满足 @nuxt/ui 组件类型解析；
 * 业务协议仍是 shared/types/protocol.ts 中的普通聊天消息。
 */
declare module "ai" {
  export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

  export interface UIDataTypes {
    [key: string]: unknown;
  }

  export interface UITools {
    [key: string]: unknown;
  }

  export interface FileUIPart {
    type: "file";
    mediaType?: string;
    filename?: string;
    url: string;
  }

  export interface TextUIPart {
    type: "text";
    text: string;
    state?: "streaming" | "done";
  }

  export interface UIMessage<
    METADATA = unknown,
    _DATA_PARTS extends UIDataTypes = UIDataTypes,
    _TOOLS extends UITools = UITools,
  > {
    id: string;
    metadata?: METADATA;
    role: "system" | "user" | "assistant";
    parts: Array<
      | TextUIPart
      | ({ type: "file" } & Partial<FileUIPart>)
      | { type: string; data?: unknown }
    >;
  }
}

export {};
