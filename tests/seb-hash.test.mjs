import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buatHashRequestSeb, cocokHashRequestSeb } from '../src/lib/seb-hash.mjs';
const bek='0123456789abcdef'.repeat(4);
const url='https://sukatryout.example/api/peserta/pengerjaan/123/aksi';

test('SEB memakai URL UTF8 diikuti 32 byte BEK, bukan 64 karakter heksadesimal',()=>{
  const resmi=createHash('sha256').update(Buffer.from(url,'utf8')).update(Buffer.from(bek,'hex')).digest('hex');
  const salah=createHash('sha256').update(url+bek).digest('hex');
  assert.equal(buatHashRequestSeb(url,bek).toString('hex'),resmi);
  assert.notEqual(resmi,salah);
});
test('Hash valid cocok dan hash URL lain ditolak',()=>{
  const header=buatHashRequestSeb(url,bek).toString('hex');
  assert.equal(cocokHashRequestSeb(url,bek,header),true);
  assert.equal(cocokHashRequestSeb(url+'/lain',bek,header),false);
  assert.equal(cocokHashRequestSeb(url,bek,'z'.repeat(64)),false);
  assert.equal(cocokHashRequestSeb(url,'bukan-bek',header),false);
});
test('Huruf BEK kapital tetap dianggap kunci sama dan fragmen URL tidak ikut hashing',()=>{
  assert.equal(buatHashRequestSeb(url,bek.toUpperCase()).toString('hex'),buatHashRequestSeb(url,bek).toString('hex'));
  assert.equal(buatHashRequestSeb(url+'#bagian',bek).toString('hex'),buatHashRequestSeb(url,bek).toString('hex'));
});
