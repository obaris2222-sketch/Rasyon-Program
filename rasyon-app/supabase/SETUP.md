# Supabase Kurulumu — Adım Adım (FAZ 16.10 / 16.11)

Bu kurulumu **bir kez** yaparsınız. Tüm kod hazır; sizden istenen yalnızca bir
Supabase projesi açıp anahtarları yapıştırmak. Tahmini süre: **10 dakika.**

> Aşama 0 (yerel temel) tamamlandı ve test edildi. Aşağıdaki adımları bitirip
> bana "kurulum hazır" dediğinizde **Aşama 1**'i (giriş ekranı + bulut senkron)
> bağlayıp birlikte canlı test edeceğiz.

---

## 1. Hesap + Proje oluştur (5 dk)

1. https://supabase.com adresine gidin → **Start your project** → GitHub veya
   e-posta ile ücretsiz kayıt olun.
2. **New project** → bir ad verin (ör. `rasyon`).
3. **Database Password** alanına güçlü bir şifre yazın → **bir yere not edin**
   (ileride lazım olabilir; senkron için ŞART değil).
4. **Region**: size en yakın / KVKK için Avrupa → **Frankfurt (eu-central-1)**
   önerilir.
5. **Create new project** → proje hazırlanırken ~2 dakika bekleyin.

## 2. Veritabanı tablolarını kur (2 dk)

1. Sol menüden **SQL Editor** → **New query**.
2. Şu dosyanın **tüm içeriğini** kopyalayıp editöre yapıştırın:
   `rasyon-app/supabase/schema.sql`
3. Sağ altta **Run** (veya Ctrl+Enter).
4. **"Success. No rows returned"** görmelisiniz → tablolar + güvenlik kuralları
   kuruldu. ✅

## 3. E-posta ile girişi aç (1 dk)

1. Sol menüden **Authentication** → **Providers** (veya **Sign In / Providers**).
2. **Email** sağlayıcısının açık (enabled) olduğundan emin olun (varsayılan açıktır).
3. Kolay test için: **Authentication → Providers → Email** altında
   **"Confirm email"** seçeneğini **kapatın** (kapalıyken kayıt olunca e-posta
   onayı beklemeden hemen giriş yapılır). İsterseniz sonra açabilirsiniz.

## 4. Anahtarları `.env` dosyasına yapıştır (2 dk)

1. Sol menüden **Project Settings** (dişli) → **API**.
2. İki değeri kopyalayın:
   - **Project URL**  (ör. `https://abcd1234.supabase.co`)
   - **Project API keys → anon / public**  (uzun bir anahtar)
3. `rasyon-app` klasöründe `.env.example` dosyasını **`.env`** adıyla kopyalayın
   ve değerleri yapıştırın:

   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...(uzun anahtar)
   ```

> ℹ️ `anon` anahtarı herkese-açık güvenlidir — gerçek koruma, veritabanındaki
> Row-Level Security (her kullanıcı yalnız kendi verisi) ile sağlanır. `.env`
> dosyası `.gitignore` ile gizli tutulur.

---

## Bitince

Bana **"Supabase kurulumu hazır"** deyin. Ben:
- `@supabase/supabase-js` paketini eklerim,
- Giriş/Kayıt ekranını + bulut senkron motorunu bağlarım,
- İki tarayıcı ile canlı test ederim (bir cihazda eklenen profil diğerinde belirir).

Hesap açmak istemezseniz veya beklemek isterseniz sorun değil — program
**girişsiz de tam çalışmaya devam eder** (tüm veri cihazınızda yerel kalır).
Bulut tamamen isteğe bağlıdır.
