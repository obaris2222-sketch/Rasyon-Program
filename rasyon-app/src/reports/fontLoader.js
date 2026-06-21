/**
 * PDF için Türkçe font yükleyici
 * DejaVu Sans TTF — Extended Latin (ş, ğ, ı, ü, ö, ç) desteği vardır.
 * CDN'den bir kez çekilir; sonraki çağrılarda bellekten döner.
 * Fetch başarısız olursa '' döner → pdfExport.js ASCII translit fallback kullanır.
 */

let _cache = null;
let _promise = null;
let _cacheBold = null;
let _promiseBold = null;

const CDN_URL =
  'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';
const CDN_URL_BOLD =
  'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf';

export async function loadTurkishFont() {
  if (_cache !== null) return _cache;
  if (_promise) return _promise;

  _promise = (async () => {
    try {
      const res = await fetch(CDN_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      _cache = bufToBase64(buf);
    } catch {
      _cache = ''; // boş = font yok, fallback kullan
    }
    return _cache;
  })();

  return _promise;
}

export async function loadTurkishFontBold() {
  if (_cacheBold !== null) return _cacheBold;
  if (_promiseBold) return _promiseBold;

  _promiseBold = (async () => {
    try {
      const res = await fetch(CDN_URL_BOLD, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      _cacheBold = bufToBase64(buf);
    } catch {
      _cacheBold = '';
    }
    return _cacheBold;
  })();

  return _promiseBold;
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(s);
}
