/** Pembungkus fetch untuk komponen klien. Melempar Error berisi pesan yang sudah ramah pengguna. */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new ApiError(body?.error ?? 'Terjadi gangguan. Coba lagi.', res.status);
  }
  return body.data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const post = <T = unknown>(url: string, data?: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const fmtWaktu = (iso: string | Date) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' WIB';

export const fmtDetik = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const d = s % 60;
  return [h, m, d].map((x) => String(x).padStart(2, '0')).join(':');
};
