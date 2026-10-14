/**
 * GET /api/attachments/:id — 下载或预览附件（需所属房间成员身份）。
 * 仅受支持的位图类型允许内联预览；SVG、HTML 等一律按下载处理，
 * 并以 nosniff 阻止内容嗅探，防止上传内容被当作页面执行。
 */
import { getAttachmentForGuest } from "../../services/attachment-service";
import { PREVIEW_IMAGE_MIMES } from "#shared/constants/mime";
import {
  apiFail,
  mapValidationError,
  noStore,
  requireGuest,
  requirePathParam,
} from "../../utils/http";

function contentDisposition(filename: string, inline: boolean): string {
  // 原文件名仅用于显示；RFC 5987 编码中文文件名
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export default defineEventHandler((event) => {
  noStore(event);
  try {
    const guest = requireGuest(event);
    const attachmentId = requirePathParam(event, "id");
    const record = getAttachmentForGuest(guest.id, attachmentId);
    const forceDownload = getQuery(event).download === "1";
    const inline =
      !forceDownload &&
      (PREVIEW_IMAGE_MIMES as readonly string[]).includes(record.mime);
    setResponseHeader(
      event,
      "Content-Type",
      inline ? record.mime : "application/octet-stream",
    );
    setResponseHeader(
      event,
      "Content-Disposition",
      contentDisposition(record.filename, inline),
    );
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(event, "Content-Length", record.data.byteLength);
    return record.data;
  } catch (error) {
    mapValidationError(error);
  }
});
