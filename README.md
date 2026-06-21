# Gelişmiş Rasyon Optimizasyon ve Sürü Yönetim Yazılımı

Bu proje, büyükbaş hayvan (özellikle süt sığırı) besleme uzmanları, veteriner hekimler, zooteknistler ve çiftlik yöneticileri için geliştirilmiş **üst düzey mekanistik bir rasyon formülasyon (Dairy Ration Optimizer)** yazılımıdır. 

Endüstri standardı olan **NASEM 2021** ve **CNCPS v6.5 (Iterative)** besleme modellerini tam entegre olarak tarayıcı üzerinde (offline-first) çalıştırır.

## 🚀 Temel Özellikler

* **Gelişmiş Modelleme:** NASEM 2021 ve CNCPS v6.5 matematiksel modelleri ile Rumen Dinamikleri (pH, peNDF, VFA), Amino Asit (Met, Lys, His) geçişleri, Metan (CH4) salınımı ve Kuru Madde Tüketimi (DMI) hesaplamaları.
* **Akıllı Optimizasyon (GLPK):** WebAssembly tabanlı GLPK (GNU Linear Programming Kit) çözücüsü ile lineer ve karmaşık tamsayılı programlama (LP/MILP) yaparak en uygun maliyetli rasyonu (Least-Cost Formulation) saniyeler içinde hesaplar.
* **Offline-First & PWA:** Uygulama tamamen istemci tarafında (Client-Side) çalışır. İnternet bağlantısı olmadan kullanılabilir. Veriler cihazın yerel veritabanında (IndexedDB) güvenle saklanır.
* **Bulut Senkronizasyonu:** İsteğe bağlı olarak **Supabase** üzerinden tüm cihazlarınız arasında veri senkronizasyonu yapılabilir.
* **Gelişmiş Raporlama:** Rasyon sonuçlarını detaylı analizlerle görüntüler ve tek tıkla **PDF** veya **Excel (XLSX)** formatında dışa aktarır.
* **Çoklu Dil Desteği (i18n):** Türkçe ve İngilizce dil seçenekleriyle küresel kullanıma uygundur.
* **Modern Arayüz:** Neumorphic (Soft-UI) tasarım prensipleriyle oluşturulmuş, kullanıcı dostu, mobil uyumlu ve hem Açık hem Koyu tema (Dark Mode) destekli arayüz.

## 🛠️ Kullanılan Teknolojiler

* **Frontend:** Vanilla JavaScript, HTML5, CSS3 (Modern CSS Variables)
* **Build Tool:** Vite
* **Solver / Optimizasyon:** GLPK (WebAssembly) & Web Workers
* **Veritabanı (Yerel):** IndexedDB (`idb` kütüphanesi)
* **Veritabanı (Bulut):** Supabase (PostgreSQL, Auth)
* **Diğer:** DOMPurify (Güvenlik), html2canvas & jspdf (PDF çıktısı), SheetJS (Excel çıktısı)
* **Test:** Vitest (1100+ Unit Test)

## 📦 Kurulum ve Çalıştırma

Projeyi bilgisayarınızda yerel olarak çalıştırmak için **Node.js** (v18+) kurulu olmalıdır.
