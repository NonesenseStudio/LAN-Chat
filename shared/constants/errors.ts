/**
 * 共享错误码。服务端返回 code，客户端映射为固定中文文案；
 * message 字段始终是面向用户、说明可执行动作的中文。
 */

export const ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "请求无效，请重试",
  UNAUTHENTICATED: "身份已失效，请重新加入",
  FORBIDDEN: "你尚未加入这个房间",
  NOT_FOUND: "内容不存在或已被清除",
  ROOM_NOT_FOUND: "房间不存在或已被清除",
  MESSAGE_TOO_LARGE: "消息内容过长，请缩短后发送",
  MESSAGE_INVALID: "消息内容无效，请修改后发送",
  ATTACHMENT_TOO_LARGE: "文件超过大小限制，请更换文件",
  ATTACHMENT_NOT_FOUND: "文件已被清除或不可访问",
  CAPACITY_EXCEEDED: "文件容量不足，请联系服务启动者",
  MESSAGE_CAPACITY_EXCEEDED: "房间消息容量已满，请联系服务启动者",
  ROOM_CAPACITY_EXCEEDED: "房间数量已达上限，请联系服务启动者",
  MEMBER_CAPACITY_EXCEEDED: "房间成员已达上限，请联系服务启动者",
  GUEST_CAPACITY_EXCEEDED: "访客人数已达上限，请联系服务启动者",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
  SERVER_FULL: "当前连接数已满，请稍后再试",
  INTERNAL: "服务出现错误，请稍后重试",
};

const FALLBACK_MESSAGE = "服务出现错误，请稍后重试";

export function errorText(code: string): string {
  return ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
