/**
 * 内存记录 → 线路 DTO 映射。保证缓冲区等内部字段不会进入响应。
 */
import type {
  AttachmentPublic,
  GuestPublic,
  MemberPublic,
  MessagePreview,
  MessageView,
  RoomPublic,
  RoomSummary,
  StoredMessage,
} from "#shared/types/entities";
import {
  useMemory,
  type AttachmentRecord,
  type GuestRecord,
  type MemberRecord,
  type RoomRecord,
} from "../stores/memory";
import { isGuestOnlineInRoom } from "./connections";

export function toGuestPublic(guest: GuestRecord): GuestPublic {
  return { ...guest };
}

export function toRoomPublic(room: RoomRecord): RoomPublic {
  return {
    id: room.id,
    name: room.name,
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    isDefault: room.isDefault,
  };
}

export function toAttachmentPublic(
  attachment: AttachmentRecord,
): AttachmentPublic {
  const {
    data: _data,
    referenced: _referenced,
    storageBytes: _storageBytes,
    ...rest
  } = attachment;
  return rest;
}

export function toMemberPublic(member: MemberRecord): MemberPublic {
  const state = useMemory();
  const guest = state.guests.get(member.guestId);
  if (!guest) throw new Error("成员对应的访客不存在");
  return {
    guest: toGuestPublic(guest),
    joinedAt: member.joinedAt,
    lastReadSeq: member.lastReadSeq,
    onlineCount: isGuestOnlineInRoom(member.roomId, member.guestId),
  };
}

export function toMessageView(message: StoredMessage): MessageView {
  const state = useMemory();
  const sender = state.guests.get(message.senderId);
  if (!sender) throw new Error("消息对应的访客不存在");
  const attachment = message.attachmentId
    ? state.attachments.get(message.attachmentId)
    : undefined;
  return {
    message,
    sender: toGuestPublic(sender),
    attachment: attachment ? toAttachmentPublic(attachment) : undefined,
  };
}

function toMessagePreview(message: StoredMessage): MessagePreview {
  const view = toMessageView(message);
  if (view.message.text === undefined || view.message.text.length <= 120)
    return view;
  let text = view.message.text.slice(0, 120);
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff)
    text = text.slice(0, -1);
  return { ...view, message: { ...view.message, text: `${text}…` } };
}

export function toRoomSummary(room: RoomRecord, selfId: string): RoomSummary {
  const state = useMemory();
  const messages = state.messages.get(room.id) ?? [];
  const last = messages.at(-1);
  const member = state.members.get(`${room.id}:${selfId}`);
  const lastReadSeq = member?.lastReadSeq ?? 0;
  let unreadCount = 0;
  let start = 0;
  let end = messages.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (messages[middle]!.seq <= lastReadSeq) start = middle + 1;
    else end = middle;
  }
  for (let i = start; i < messages.length; i++) {
    if (messages[i]!.senderId !== selfId) unreadCount++;
  }
  const memberIds = state.roomMemberIds.get(room.id)?.size ?? 0;
  return {
    room: toRoomPublic(room),
    lastMessage: last ? toMessagePreview(last) : undefined,
    unreadCount,
    memberCount: memberIds,
    lastActivityAt: last?.createdAt ?? member?.joinedAt ?? room.createdAt,
  };
}
