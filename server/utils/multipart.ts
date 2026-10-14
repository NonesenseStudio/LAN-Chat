/**
 * multipart/form-data 解析：基于整块 Buffer 的轻量实现。
 * 使用它而非 h3 readMultipartFormData 的原因：请求体先按实际字节限制读取，
 * 避免未知长度请求绕过内存预算（docs/implementation-plan.md 8.3 节）。
 */

export interface MultipartFile {
  filename: string;
  mime: string;
  data: Buffer;
}

function getBoundary(contentType: string): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary?.trim() || undefined;
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0)
      headers[line.slice(0, idx).trim().toLowerCase()] = line
        .slice(idx + 1)
        .trim();
  }
  return headers;
}

function decodeFilename(disposition: string): string | undefined {
  // filename*=UTF-8''%E4%B8%AD.txt 优先；其次 filename="x.png"
  const ext = /filename\*=(?:utf-8|UTF-8)''([^;\r\n]+)/.exec(disposition);
  if (ext?.[1]) {
    try {
      return decodeURIComponent(ext[1].trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  const plain = /filename="((?:[^"\\]|\\.)*)"/.exec(disposition);
  if (plain?.[1] !== undefined) {
    return plain[1].replace(/\\(.)/g, "$1") || undefined;
  }
  const bare = /filename=([^;\r\n]+)/.exec(disposition);
  return bare?.[1]?.trim() || undefined;
}

/**
 * 从 multipart 请求体中提取第一个文件部分（字段名 file）。
 * 未找到或格式非法时返回 undefined，由调用方决定报错。
 */
export function parseMultipartFile(
  body: Buffer,
  contentTypeHeader: string,
): MultipartFile | undefined {
  const boundary = getBoundary(contentTypeHeader);
  if (!boundary) return undefined;
  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const CRLF = Buffer.from("\r\n", "utf8");
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`, "utf8");

  let pos = body.indexOf(delimiter);
  while (pos !== -1) {
    const afterDelimiter = pos + delimiter.length;
    // 终止标记：--boundary--
    if (body[afterDelimiter] === 0x2d && body[afterDelimiter + 1] === 0x2d)
      break;
    const lineEnd = body.indexOf(CRLF, pos);
    if (lineEnd === -1) break;
    const headersEnd = body.indexOf("\r\n\r\n", lineEnd);
    if (headersEnd === -1) break;
    const headerBlock = body.slice(lineEnd + 2, headersEnd).toString("utf8");
    const headers = parseHeaderBlock(headerBlock);
    const contentStart = headersEnd + 4;
    const contentEnd = body.indexOf(nextDelimiter, contentStart);
    if (contentEnd === -1) break;

    const disposition = headers["content-disposition"] ?? "";
    const filename = decodeFilename(disposition);
    const fieldName = /(?:^|;)\s*name="((?:[^"\\]|\\.)*)"/.exec(
      disposition,
    )?.[1];
    if (filename && fieldName === "file") {
      return {
        filename,
        mime: headers["content-type"] || "application/octet-stream",
        data: body.slice(contentStart, contentEnd),
      };
    }
    pos = body.indexOf(delimiter, contentEnd);
  }
  return undefined;
}
