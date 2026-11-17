/** Error yang aman ditampilkan ke pengguna. Error lain dianggap 500 dan pesannya tidak dibocorkan. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

export function jsonError(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status });
  }
  console.error('[sukatryoutup]', (err as Error)?.message ?? err);
  return Response.json({ ok: false, error: 'Terjadi gangguan server. Coba lagi sebentar.' }, { status: 500 });
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}
