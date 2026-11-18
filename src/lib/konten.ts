/**
 * Helper konten (soal, opsi, rubrik) yang dipakai server maupun klien.
 * Tidak mengimpor modul server, sehingga aman dibundel untuk browser.
 */

const PETA_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => PETA_ESCAPE[c]);
}

/** Apakah teks mengandung tag HTML. Teks lama (plain text) tidak mengandung tag. */
export function adaHtml(s: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(s);
}

/** Mengubah konten tersimpan menjadi HTML untuk ditampilkan. Teks biasa di-escape lalu baris barunya diubah menjadi <br>. */
export function kontenKeHtml(s: string): string {
  if (!s) return '';
  if (adaHtml(s)) return s;
  return escapeHtml(s).replace(/\r?\n/g, '<br />');
}

/** Teks polos dari konten HTML, untuk daftar dan cuplikan. */
export function teksPolos(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
