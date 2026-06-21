/**
 * Hava Durumu API Modülü (FAZ 16.9)
 * 
 * Open-Meteo ücretsiz API servisini kullanarak verilen enlem ve boylam 
 * koordinatlarındaki anlık sıcaklık ve bağıl nem değerlerini çeker.
 * Kayıt veya API Key gerektirmez.
 */

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Belirtilen koordinatlar için anlık hava durumunu getirir.
 * 
 * @param {number} lat - Enlem (Latitude)
 * @param {number} lon - Boylam (Longitude)
 * @returns {Promise<{ temperature: number, humidity: number }>}
 * @throws {Error} - İlgili koordinatlar geçersizse veya ağ hatası olursa fırlatır.
 */
export async function fetchCurrentWeather(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) {
    throw new Error('Geçerli bir enlem ve boylam değeri gereklidir.');
  }

  // API query: anlık sıcaklık ve bağıl nem
  const url = `${BASE_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API hatası: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !data.current) {
      throw new Error('Geçersiz API yanıtı');
    }

    return {
      temperature: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
    };
  } catch (error) {
    throw new Error(`Hava durumu alınamadı: ${error.message}`);
  }
}

/**
 * Koordinatları yer adına çevirir (reverse geocoding) — denetim #19.
 * BigDataCloud ücretsiz/anahtarsız istemci API'si. Hata olursa null döner (kritik değil;
 * enlem/boylam yine de kullanılabilir). Örn. (40.15, 26.41) → "Çanakkale, Çanakkale, Türkiye".
 *
 * @param {number} lat - Enlem
 * @param {number} lon - Boylam
 * @returns {Promise<{ name: string, city: string, region: string, country: string } | null>}
 */
export async function reverseGeocode(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) return null;
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=tr`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const city = d.city || d.locality || d.principalSubdivision || '';
    const region = d.principalSubdivision || '';
    const country = d.countryName || '';
    const parts = [city, (region && region !== city) ? region : '', country].filter(Boolean);
    const name = parts.join(', ');
    return {
      name: name || `${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)}`,
      city, region, country,
    };
  } catch {
    return null;  // ağ/parse hatası → sessiz (konum adı opsiyonel)
  }
}
