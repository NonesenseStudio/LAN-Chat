/**
 * 附件业务：内存容量预留、登记、访问校验与回收。
 * docs/implementation-plan.md 8.3 节：
 * - 上传前按声明长度预留容量，完成后按实际字节数结算；
 * - 未被消息引用的缓冲区定期回收；
 * - 访问附件必须重新校验房间成员关系。
 */
import type { GuestRecord } from "../stores/memory";
import type { AttachmentPublic } from "#shared/types/entities";
import { UNREFERENCED_ATTACHMENT_TTL_MS } from "#shared/constants/limits";
import { MULTIPART_OVERHEAD_BYTES } from "#shared/constants/limits";
import { ValidationError } from "../utils/validate";
import { randomId } from "../utils/ids";
import { toAttachmentPublic } from "../utils/dto";
import { memberKey, useMemory, type AttachmentRecord } from "../stores/memory";

/** 上传开始前按声明长度（multipart 请求体总长，含表单开销）预留 */
export function reserveForUpload(declaredBytes: number) {
  const state = useMemory();
  if (
    declaredBytes >
    state.limits.maxAttachmentBytes + MULTIPART_OVERHEAD_BYTES
  ) {
    throw new ValidationError(
      "ATTACHMENT_TOO_LARGE",
      "文件超过大小限制，请更换文件",
    );
  }
  if (
    state.attachmentBytes + state.reservedBytes + declaredBytes >
    state.limits.maxTotalAttachmentBytes
  ) {
    throw new ValidationError(
      "CAPACITY_EXCEEDED",
      "文件容量不足，请联系服务启动者",
    );
  }
  state.reservedBytes += declaredBytes;
}

/** 读取完成后按实际字节数结算预留；容量不足时抛错且预留原样保留，由调用方释放 */
export function settleReservation(
  declaredBytes: number,
  actualBytes: number,
  fileBytes: number,
): void {
  const state = useMemory();
  if (
    actualBytes > state.limits.maxAttachmentBytes + MULTIPART_OVERHEAD_BYTES ||
    fileBytes > state.limits.maxAttachmentBytes
  ) {
    throw new ValidationError(
      "ATTACHMENT_TOO_LARGE",
      "文件超过大小限制，请更换文件",
    );
  }
  if (
    state.attachmentBytes + actualBytes >
    state.limits.maxTotalAttachmentBytes
  ) {
    throw new ValidationError(
      "CAPACITY_EXCEEDED",
      "文件容量不足，请联系服务启动者",
    );
  }
  state.reservedBytes = Math.max(0, state.reservedBytes - declaredBytes);
  state.attachmentBytes += actualBytes;
}

/** 上传失败或中止时释放预留 */
export function releaseReservation(declaredBytes: number) {
  const state = useMemory();
  state.reservedBytes = Math.max(0, state.reservedBytes - declaredBytes);
}

export function registerAttachment(input: {
  roomId: string;
  owner: GuestRecord;
  filename: string;
  mime: string;
  data: Buffer;
  storageBytes: number;
}): AttachmentRecord {
  const state = useMemory();
  const record: AttachmentRecord = {
    id: randomId(16),
    roomId: input.roomId,
    ownerId: input.owner.id,
    filename: input.filename,
    size: input.data.byteLength,
    mime: input.mime,
    createdAt: new Date().toISOString(),
    data: input.data,
    referenced: false,
    storageBytes: input.storageBytes,
  };
  state.attachments.set(record.id, record);
  return record;
}

/** 下载/预览前重新校验：附件存在且访问者仍是所属房间成员 */
export function getAttachmentForGuest(
  selfId: string,
  attachmentId: string,
): AttachmentRecord {
  const state = useMemory();
  const record = state.attachments.get(attachmentId);
  if (!record)
    throw new ValidationError("ATTACHMENT_NOT_FOUND", "文件已被清除或不可访问");
  if (!state.members.has(memberKey(record.roomId, selfId))) {
    throw new ValidationError("FORBIDDEN", "你尚未加入这个房间");
  }
  return record;
}

export function attachmentSummary(
  attachment: AttachmentRecord,
): AttachmentPublic {
  return toAttachmentPublic(attachment);
}

/** 回收未被任何消息引用且超过保留时长的缓冲区；返回释放的字节数 */
export function sweepUnreferencedAttachments(): number {
  const state = useMemory();
  const now = Date.now();
  let freed = 0;
  for (const [id, record] of state.attachments) {
    if (
      !record.referenced &&
      now - Date.parse(record.createdAt) > UNREFERENCED_ATTACHMENT_TTL_MS
    ) {
      state.attachments.delete(id);
      freed += record.storageBytes;
    }
  }
  state.attachmentBytes = Math.max(0, state.attachmentBytes - freed);
  return freed;
}

/** 删除空房间时一并释放其附件缓冲区。 */
export function removeRoomAttachments(roomId: string): number {
  const state = useMemory();
  let freed = 0;
  for (const [id, record] of state.attachments) {
    if (record.roomId !== roomId) continue;
    state.attachments.delete(id);
    freed += record.storageBytes;
  }
  state.attachmentBytes = Math.max(0, state.attachmentBytes - freed);
  return freed;
}

export function memoryUsage(): {
  attachmentBytes: number;
  reservedBytes: number;
  attachmentCount: number;
} {
  const state = useMemory();
  return {
    attachmentBytes: state.attachmentBytes,
    reservedBytes: state.reservedBytes,
    attachmentCount: state.attachments.size,
  };
}
