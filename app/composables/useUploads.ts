/**
 * 附件上传：XHR 进度、取消、失败重试。
 * 上传成功后得到 AttachmentPublic，随消息发送引用；本地上传中用对象 URL 预览。
 */
import type { AttachmentPublic } from "#shared/types/entities";
import { PREVIEW_IMAGE_MIMES } from "#shared/constants/mime";

export type UploadStatus = "uploading" | "done" | "failed" | "cancelled";

export interface UploadItem {
  localId: string;
  roomId: string;
  file: File;
  filename: string;
  size: number;
  mime: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  attachment?: AttachmentPublic;
  /** 本地预览（图片） */
  objectUrl?: string;
  xhr?: XMLHttpRequest;
}

export function useUploads() {
  const items = useState<UploadItem[]>("uploads", () => []);
  const socket = useChatSocket();

  const maxAttachmentBytes = computed(
    () => socket.capabilities.value?.maxAttachmentBytes ?? 0,
  );

  function update(localId: string, patch: Partial<UploadItem>) {
    items.value = items.value.map((item) =>
      item.localId === localId ? { ...item, ...patch } : item,
    );
  }

  /** 上传一个文件到指定房间；同 localId 重试时复用条目 */
  function upload(
    roomId: string,
    file: File,
    existingLocalId?: string,
  ): UploadItem {
    const localId = existingLocalId ?? newLocalId();
    let item = items.value.find((candidate) => candidate.localId === localId);
    if (!item) {
      item = {
        localId,
        roomId,
        file,
        filename: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        progress: 0,
        status: "uploading",
        ...((PREVIEW_IMAGE_MIMES as readonly string[]).includes(file.type)
          ? { objectUrl: URL.createObjectURL(file) }
          : {}),
      };
      items.value = [...items.value, item];
    }
    startRequest(item);
    return item;
  }

  function startRequest(item: UploadItem) {
    update(item.localId, {
      status: "uploading",
      progress: 0,
      error: undefined,
    });
    const xhr = new XMLHttpRequest();
    update(item.localId, { xhr });
    xhr.open("POST", `/api/rooms/${item.roomId}/attachments`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        update(item.localId, {
          progress: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as { attachment?: AttachmentPublic };
        if (body?.attachment) {
          update(item.localId, {
            status: "done",
            progress: 100,
            attachment: body.attachment,
          });
          return;
        }
      }
      const err = xhr.response as { code?: string; message?: string } | null;
      update(item.localId, {
        status: "failed",
        error: err?.message ?? uploadErrorMessage(xhr.status),
      });
    };
    xhr.onerror = () =>
      update(item.localId, {
        status: "failed",
        error: "上传失败，请检查网络后重试",
      });
    xhr.onabort = () => update(item.localId, { status: "cancelled" });
    xhr.send(buildFormData(item.file));
  }

  function uploadErrorMessage(status: number): string {
    if (status === 413) return "文件过大或服务容量已满";
    if (status === 401) return "身份已失效，请重新加入";
    if (status === 403) return "你尚未加入这个房间";
    if (status === 429) return "操作过于频繁，请稍后再试";
    return "上传失败";
  }

  function buildFormData(file: File): FormData {
    const form = new FormData();
    form.append("file", file);
    return form;
  }

  /** 上传前本地校验：大小按服务端发布的能力参数 */
  function validate(roomId: string, file: File): string | null {
    void roomId;
    const cap = maxAttachmentBytes.value;
    if (cap > 0 && file.size > cap) {
      return `文件过大（上限 ${formatBytes(cap)}）`;
    }
    return null;
  }

  function cancel(localId: string) {
    const item = items.value.find((candidate) => candidate.localId === localId);
    if (item?.xhr && item.xhr.readyState !== XMLHttpRequest.DONE) {
      item.xhr.abort();
    }
    remove(localId);
  }

  function remove(localId: string) {
    const item = items.value.find((candidate) => candidate.localId === localId);
    if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
    items.value = items.value.filter(
      (candidate) => candidate.localId !== localId,
    );
  }

  /** 服务重启后附件引用作废 */
  function resetAll() {
    for (const item of items.value) {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    }
    items.value = [];
  }

  return {
    items,
    upload,
    validate,
    cancel,
    remove,
    resetAll,
    maxAttachmentBytes,
  };
}

function newLocalId(): string {
  return `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
