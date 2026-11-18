import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Spesifikasi SEB Browser Exam Key: SHA256(UTF8(absoluteURL) || 32 bytes BEK).
 * BEK dari Config Tool adalah hex 64 karakter (32 byte), bukan teks ASCII hex.
 * Lihat spesifikasi resmi Browser Exam Key: safeexambrowser.org/developer/
 */
export function buatHashRequestSeb(url, bekHex) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('URL permintaan tidak valid');
  if (typeof bekHex !== 'string' || !/^[0-9a-f]{64}$/i.test(bekHex)) throw new Error('BEK wajib 64 heksadesimal');
  const urlTanpaFragmen = url.split('#')[0];
  return createHash('sha256').update(urlTanpaFragmen, 'utf8').update(Buffer.from(bekHex, 'hex')).digest();
}
export function cocokHashRequestSeb(url, bekHex, receivedHex) {
  if (typeof receivedHex !== 'string' || !/^[0-9a-f]{64}$/i.test(receivedHex)) return false;
  try {
    return timingSafeEqual(buatHashRequestSeb(url, bekHex), Buffer.from(receivedHex, 'hex'));
  } catch { return false; }
}
