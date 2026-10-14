/**
 * POST /api/rooms/:id/attachments — 上传附件（multipart/form-data，字段名 file）。
 * 上传前按声明长度预留容量；按实际读取字节结算；返回 attachmentId。
 */
import type { AttachmentUploadResponse } from "#shared/types/api";
import { getRequestHeader } from "h3";
import { MULTIPART_OVERHEAD_BYTES } from "#shared/constants/limits";
import {
  attachmentSummary,
  registerAttachment,
  releaseReservation,
  reserveForUpload,
  settleReservation,
} from "../../../services/attachment-service";
import { memberKey, useMemory } from "../../../stores/memory";
import {
  apiFail,
  assertWriteOrigin,
  mapValidationError,
  noStore,
  readCappedRequestBody,
  requireWriteGuest,
  requirePathParam,
} from "../../../utils/http";
import { parseMultipartFile } from "../../../utils/multipart";

const FILENAME_MAX_LENGTH = 200;

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f]/g, "_").trim();
  return (cleaned || "未命名文件").slice(0, FILENAME_MAX_LENGTH);
}

export default defineEventHandler(
  async (event): Promise<AttachmentUploadResponse> => {
    noStore(event);
    let reserved = 0;
    try {
      assertWriteOrigin(event);
      const guest = requireWriteGuest(event);
      const roomId = requirePathParam(event, "id");
      // 上传前校验房间成员关系
      if (!useMemory().members.has(memberKey(roomId, guest.id))) {
        apiFail("FORBIDDEN");
      }
      const contentType = getRequestHeader(event, "content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
        apiFail("BAD_REQUEST", "请使用 multipart/form-data 上传文件");
      }
      // 分块传输没有可信总长度；浏览器表单上传总是携带 content-length
      if (getRequestHeader(event, "transfer-encoding")) {
        apiFail("BAD_REQUEST", "不支持分块上传，请直接选择文件上传");
      }
      const declared = Number(getRequestHeader(event, "content-length") ?? "0");
      if (!Number.isFinite(declared) || declared <= 0) {
        apiFail("BAD_REQUEST", "请求缺少文件内容");
      }
      reserveForUpload(declared);
      reserved = declared;

      // 按实际请求体读取；上传有明确长度且已预留总容量。
      const body = await readCappedRequestBody(
        event,
        useMemory().limits.maxAttachmentBytes + MULTIPART_OVERHEAD_BYTES,
        "ATTACHMENT_TOO_LARGE",
        "文件超过大小限制，请更换文件",
      );
      if (!body || body.byteLength === 0) {
        releaseReservation(reserved);
        reserved = 0;
        apiFail("BAD_REQUEST", "请求缺少文件内容");
      }
      const file = parseMultipartFile(body, contentType);
      if (!file) {
        apiFail("BAD_REQUEST", "未找到上传的文件");
      }
      if (file.data.byteLength > useMemory().limits.maxAttachmentBytes) {
        apiFail("ATTACHMENT_TOO_LARGE");
      }
      // 按实际请求体和文件字节数结算；解析失败时 catch 仍会释放预留。
      settleReservation(declared, body.byteLength, file.data.byteLength);
      reserved = 0;
      const record = registerAttachment({
        roomId,
        owner: guest,
        filename: sanitizeFilename(file.filename),
        mime: file.mime,
        data: file.data,
        storageBytes: body.byteLength,
      });
      return { attachment: attachmentSummary(record) };
    } catch (error) {
      if (reserved > 0) releaseReservation(reserved);
      mapValidationError(error);
    }
  },
);
