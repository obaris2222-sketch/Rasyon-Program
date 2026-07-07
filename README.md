# NutriOpt 🐄 🌾

**NutriOpt**, süt sığırları için **NRC 2001**, **NASEM 2021** ve **CNCPS v6.5** besleme modellerini temel alan, modern ve kapsamlı bir rasyon optimizasyon programıdır. Çevrimdışı çalışabilen PWA (Progressive Web App) yapısı, yapay zeka asistan desteği ve bulut senkronizasyonu ile hem sahada hem de masa başında güvenle kullanılabilir.

## 🌟 Öne Çıkan Özellikler

- **Gelişmiş Optimizasyon Modelleri:** NRC 2001, NASEM 2021 ve CNCPS v6.5 standartlarına göre bilimsel rasyon hesaplama.
- **Çevrimdışı Kullanım (PWA):** İnternet bağlantısı olmadan IndexedDB altyapısıyla sahada, ahırda kesintisiz çalışma imkanı.
- **Bulut Senkronizasyonu (Supabase):** Çiftlik verilerinizi, rasyonlarınızı ve hayvan profillerinizi bulutta güvenle saklayın ve cihazlar arası anında eşitleyin.
- **AI Asistan Entegrasyonu:** Rasyon hazırlarken, verileri yorumlarken veya hayvan besleme konularında anında danışabileceğiniz entegre yapay zeka asistanı.
- **Kapsamlı Yönetim Araçları:**
  - **Hayvan Profili Yönetimi:** Laktasyon durumu, süt verimi, canlı ağırlık gibi parametrelerin takibi.
  - **Geniş Yem Veritabanı:** Besin madde analizleriyle detaylandırılmış özelleştirilebilir yem deposu.
  - **Fiyat ve Maliyet Yöneticisi:** Yem maliyetlerinin güncel takibi ile en ekonomik rasyonun oluşturulması.
  - **Çiftlik Paneli ve Saha Gözlem Takibi:** Sürü bazlı değerlendirmeler ve dışkı, kondisyon gibi saha gözlemleri.
- **Gelişmiş Raporlama:** Rasyon sonuçlarını ve analizleri grafiklerle görüntüleme, Excel ve PDF formatlarında dışa aktarma.
- **Modern ve Duyarlı Arayüz:** Karanlık/Aydınlık (Dark/Light) tema desteği ve mobil/tablet cihazlarla tam uyumlu (Responsive) kullanıcı dostu tasarım.

## 🛠️ Kullanılan Teknolojiler

**Frontend:**
- JavaScript (ES6+ Modül yapısı)
- HTML5 & CSS3 (Vite ile yapılandırılmış)
- PWA Altyapısı (`vite-plugin-pwa`)

**Backend & Veri Yönetimi:**
- [Supabase](https://supabase.com/) (`@supabase/supabase-js`) - Veritabanı ve Kimlik Doğrulama
- IndexedDB (`idb`) - Çevrimdışı veri depolama

**Optimizasyon & Hesaplama:**
- `glpk.js` - Doğrusal programlama (Linear Programming) ile minimum maliyetli rasyon optimizasyonu

**Veri Görselleştirme & Çıktı Alma:**
- `chart.js` - Besin değerleri ve maliyet grafikleri
- `jspdf` & `jspdf-autotable` - PDF raporları oluşturma
- `xlsx` - Excel (Spreadsheet) formatında veri içe/dışa aktarımı

**Araçlar & Kütüphaneler:**
- `marked` & `dompurify` - AI Asistan çıktıları için güvenli Markdown ayrıştırma
- Tabler Icons (`@tabler/icons-webfont`) - Arayüz ikonları

## 📂 Proje Yapısı

```text
rasyon-app/
├── public/              # Statik dosyalar ve PWA ikonları
├── src/                 # Kaynak kodları
│   ├── ui/              # Arayüz bileşenleri, app.js, UI mantığı ve stiller
│   ├── core/            # Optimizasyon motoru, hesaplama fonksiyonları
│   └── utils/           # Yardımcı metodlar
├── supabase/            # Supabase veritabanı şemaları
├── tests/               # Vitest ile yazılmış birim testleri
├── index.html           # Ana giriş HTML dosyası
├── package.json         # Proje bağımlılıkları ve NPM scriptleri
└── vite.config.js       # Vite ve PWA konfigürasyonları
```

## 🚀 Kurulum ve Çalıştırma

Projeyi kendi bilgisayarınızda çalıştırmak veya geliştirmeye katkıda bulunmak için aşağıdaki adımları izleyin:

### Gereksinimler
- Node.js (v18 veya üzeri önerilir)
- NPM veya Yarn paket yöneticisi

### Adımlar

1. **Depoyu klonlayın:**
   ```bash
   git clone https://github.com/KULLANICI_ADINIZ/Rasyon-Program.git
   cd Rasyon-Program/rasyon-app
   ```

2. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

3. **Çevre Değişkenlerini (Environment Variables) Ayarlayın:**
   Proje ana dizininde bulunan `.env` dosyasını (eğer yoksa oluşturarak) yapılandırın. Supabase ve AI API anahtarlarınızı buraya ekleyin.

4. **Geliştirme sunucusunu başlatın:**
   ```bash
   npm run dev
   ```
   Terminalde belirtilen adrese (genellikle `http://localhost:5173`) tarayıcınızdan giderek projeyi görüntüleyebilirsiniz.

5. **Üretim (Production) için derleme yapın:**
   ```bash
   npm run build
   ```

## 🧪 Testler

Uygulamanın hesaplama algoritmalarını ve bileşenlerini test etmek için **Vitest** kullanılmaktadır:

```bash
# Testleri bir kez çalıştır
npm run test

# Testleri izleme (watch) modunda çalıştır (Geliştirme sırasında kullanışlıdır)
npm run test:watch

# Test kapsam (coverage) raporu oluştur
npm run test:coverage
```

## 📝 Lisans ve İletişim

Bu proje açık kaynak veya özel olarak geliştirilmiş olabilir. Lisans detayları için deponun kök dizinindeki `LICENSE` dosyasına göz atabilirsiniz.
Katkıda bulunmak, hata bildirmek veya önerilerinizi sunmak için GitHub üzerinden *Issue* açabilirsiniz.
