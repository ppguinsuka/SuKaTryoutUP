'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Bold, Code2, Heading2, Heading3, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Redo2, Table2, Underline, Undo2 } from 'lucide-react';
import { kontenKeHtml } from '@/lib/konten';

const MAKS_BERKAS = 8_000_000; // byte, sebelum dikompres
const MAKS_HASIL = 1_500_000; // karakter data URL setelah dikompres

function escapeAttr(v: string) {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Mengubah gambar menjadi data URL base64 (JPEG) yang sudah dikecilkan.
 * Lebar dibatasi 1000 px dan kualitas diturunkan bertahap sampai ukurannya wajar.
 */
export async function gambarKeBase64(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar (PNG, JPG, WebP, atau GIF).');
  if (file.size > MAKS_BERKAS) throw new Error('Ukuran gambar maksimal 8 MB sebelum dikompres.');
  const bitmap = await createImageBitmap(file);
  const skala = Math.min(1, 1000 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * skala));
  canvas.height = Math.max(1, Math.round(bitmap.height * skala));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak dapat memproses gambar.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const kualitas of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', kualitas);
    if (url.length <= MAKS_HASIL) return url;
  }
  throw new Error('Gambar masih terlalu besar setelah dikompres. Gunakan gambar yang lebih kecil.');
}

/** Membersihkan pratinjau dari script dan atribut berbahaya. Server tetap membersihkan ulang saat menyimpan. */
export function pratinjauAman(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((el) => el.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const nama = attr.name.toLowerCase();
      const nilai = attr.value.trim().toLowerCase();
      if (nama.startsWith('on') || ((nama === 'href' || nama === 'src') && nilai.startsWith('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  const wadah = document.createElement('div');
  wadah.appendChild(tpl.content.cloneNode(true));
  return wadah.innerHTML;
}

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Mode ringkas untuk pilihan jawaban: tanpa pratinjau. */
  compact?: boolean;
  readOnly?: boolean;
};

export function RichEditor({ label, value, onChange, placeholder, compact = false, readOnly = false }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const terakhirRef = useRef<string>(value || '');
  const rentangRef = useRef<Range | null>(null);
  const paksaRef = useRef(false);
  const [sumber, setSumber] = useState(false);
  const [pratinjau, setPratinjau] = useState('');

  // Sinkronkan DOM dengan nilai dari luar, tanpa menimpa saat pengguna sedang mengetik.
  useEffect(() => {
    if (sumber) return;
    const el = editorRef.current;
    if (!el) return;
    const berikutnya = value || '';
    if (berikutnya !== terakhirRef.current || paksaRef.current) {
      el.innerHTML = kontenKeHtml(berikutnya);
      terakhirRef.current = berikutnya;
      paksaRef.current = false;
    }
  }, [value, sumber]);

  // Simpan posisi kursor di dalam editor, supaya tombol toolbar tetap menyisipkan di tempat yang benar.
  useEffect(() => {
    const simpan = () => {
      const sel = window.getSelection();
      const el = editorRef.current;
      if (sel && sel.rangeCount && el && el.contains(sel.anchorNode)) rentangRef.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', simpan);
    return () => document.removeEventListener('selectionchange', simpan);
  }, []);

  useEffect(() => {
    if (compact || sumber) return;
    setPratinjau(pratinjauAman(value || ''));
  }, [value, compact, sumber]);

  const commit = () => {
    if (readOnly) return;
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML === '<br>' ? '' : el.innerHTML;
    terakhirRef.current = html;
    onChange(html);
  };

  const fokus = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (rentangRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(rentangRef.current);
    }
  };

  const jalankan = (perintah: string, nilai?: string) => {
    fokus();
    document.execCommand(perintah, false, nilai);
    commit();
  };

  const sisipkanHtml = (html: string) => {
    fokus();
    document.execCommand('insertHTML', false, html);
    commit();
  };

  const buatTautan = () => {
    const url = window.prompt('Masukkan tautan (https://...):', 'https://');
    if (!url || !/^(https?:\/\/|mailto:)/i.test(url.trim())) {
      if (url) window.alert('Tautan harus diawali http://, https://, atau mailto:.');
      return;
    }
    jalankan('createLink', url.trim());
  };

  const pilihGambar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const src = await gambarKeBase64(file);
      const alt = escapeAttr(file.name.replace(/\.[^.]+$/, '') || 'gambar');
      sisipkanHtml(`<img src="${src}" alt="${alt}" />`);
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  const alatNonaktif = readOnly || sumber;
  const alat = [
    { judul: 'Tebal', Ikon: Bold, aksi: () => jalankan('bold') },
    { judul: 'Miring', Ikon: Italic, aksi: () => jalankan('italic') },
    { judul: 'Garis bawah', Ikon: Underline, aksi: () => jalankan('underline') },
    { judul: 'Judul 2', Ikon: Heading2, aksi: () => jalankan('formatBlock', 'H2') },
    { judul: 'Judul 3', Ikon: Heading3, aksi: () => jalankan('formatBlock', 'H3') },
    { judul: 'Daftar poin', Ikon: List, aksi: () => jalankan('insertUnorderedList') },
    { judul: 'Daftar nomor', Ikon: ListOrdered, aksi: () => jalankan('insertOrderedList') },
    { judul: 'Tautan', Ikon: LinkIcon, aksi: buatTautan },
    { judul: 'Sisipkan gambar (disimpan sebagai base64)', Ikon: ImagePlus, aksi: () => fileRef.current?.click() },
    {
      judul: 'Tabel',
      Ikon: Table2,
      aksi: () => sisipkanHtml('<table><tbody><tr><th>Kolom 1</th><th>Kolom 2</th></tr><tr><td>Isi</td><td>Isi</td></tr></tbody></table>'),
    },
    { judul: 'Undo', Ikon: Undo2, aksi: () => jalankan('undo') },
    { judul: 'Redo', Ikon: Redo2, aksi: () => jalankan('redo') },
  ];

  return (
    <div className={compact ? 'field wysiwyg-compact' : 'field full'}>
      {!compact && <label>{label}</label>}
      <div className="editor-shell enhanced-editor wysiwyg-editor">
        <div className="editor-toolbar" role="toolbar" aria-label={`Toolbar ${label}`}>
          {alat.map(({ judul, Ikon, aksi }) => (
            <button
              key={judul}
              type="button"
              className="editor-tool-button"
              title={judul}
              aria-label={judul}
              disabled={alatNonaktif}
              onMouseDown={(e) => e.preventDefault()}
              onClick={aksi}
            >
              <Ikon size={18} />
            </button>
          ))}
          <button
            type="button"
            className={`editor-tool-button${sumber ? ' is-active' : ''}`}
            title={sumber ? 'Tutup source HTML' : 'Lihat source HTML'}
            aria-label="Source HTML"
            aria-pressed={sumber}
            disabled={readOnly}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!sumber) commit();
              else paksaRef.current = true; // kembali dari source: muat ulang isi editor visual
              setSumber((s) => !s);
            }}
          >
            <Code2 size={18} />
          </button>
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/*" onChange={pilihGambar} disabled={readOnly} />
        </div>

        <div className="editor-content wysiwyg-content">
          {sumber ? (
            <textarea
              className="editor-source"
              aria-label={`${label} source HTML`}
              value={value || ''}
              spellCheck={false}
              readOnly={readOnly}
              onChange={(e) => {
                terakhirRef.current = e.target.value;
                onChange(e.target.value);
              }}
            />
          ) : (
            <div
              ref={editorRef}
              className="editor-canvas"
              contentEditable={!readOnly}
              suppressContentEditableWarning
              role="textbox"
              aria-label={label}
              aria-readonly={readOnly}
              data-placeholder={placeholder || 'Tulis konten di sini. Gunakan toolbar untuk format teks, tabel, dan gambar.'}
              onInput={commit}
              onBlur={commit}
            />
          )}
        </div>

        {!compact && (
          <div className="editor-preview">
            <strong>Pratinjau</strong>
            {pratinjau ? (
              <div className="reading-content" dangerouslySetInnerHTML={{ __html: pratinjau }} />
            ) : (
              <div className="muted">Pratinjau akan tampil setelah konten ditulis.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
