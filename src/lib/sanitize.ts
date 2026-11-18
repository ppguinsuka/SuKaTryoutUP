import sanitizeHtml from 'sanitize-html';

/** Batas ukuran konten (termasuk gambar base64) yang disimpan untuk satu soal. */
export const MAKS_KONTEN = 2_000_000;

const GAMBAR_DATA = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Membersihkan HTML dari editor WYSIWYG sebelum disimpan.
 * Hanya tag format dasar yang diizinkan, gambar hanya berupa data URI base64, dan tautan hanya http(s)/mailto.
 * Script, style, event handler, dan atribut lain dibuang.
 */
export function bersihkanHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'a',
      'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span', 'sub', 'sup', 'blockquote',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !GAMBAR_DATA.test(frame.attribs.src ?? ''),
  });
}
