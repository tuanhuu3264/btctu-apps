export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/** GET từ trình duyệt bằng cookie phiên; ném lỗi với thông điệp của máy chủ. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  throw new Error(data?.message ?? `Thao tác thất bại (HTTP ${res.status})`);
}

/** Gọi API từ trình duyệt bằng cookie phiên; ném lỗi với thông điệp của máy chủ. Trả về null khi 204. */
export async function apiCall<T = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
  throw new Error(message ?? `Thao tác thất bại (HTTP ${res.status})`);
}

/** Gửi form nhiều tệp (multipart, trường `files`) bằng `method`; `fields` là các trường văn bản kèm theo. */
export async function apiUploadMany<T = unknown>(path: string, files: File[], fields: Record<string, string> = {}): Promise<T> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  for (const f of files) body.append('files', f);
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', credentials: 'include', body });
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
  throw new Error(message ?? `Tải tệp thất bại (HTTP ${res.status})`);
}

/** Tải một tệp lên (multipart, trường `file`); `fields` là các trường văn bản kèm theo. Ném lỗi với thông điệp của máy chủ. */
export async function apiUpload<T = unknown>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  body.append('file', file);
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', credentials: 'include', body });
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
  throw new Error(message ?? `Tải tệp thất bại (HTTP ${res.status})`);
}
