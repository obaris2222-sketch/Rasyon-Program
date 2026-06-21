import fs from 'fs';
import path from 'path';
import { optimizeRation } from '../src/solver/rationOptimizer.js';
import feedLibraryJSON from '../src/data/feedLibrary.json' with { type: "json" };
import feedLibraryExtJSON from '../src/data/feedLibraryExt.json' with { type: "json" };
import feedLibraryExt2JSON from '../src/data/feedLibraryExt2.json' with { type: "json" };
import feedLibraryExt3JSON from '../src/data/feedLibraryExt3.json' with { type: "json" };

const allFeeds = [
  ...feedLibraryJSON.feeds,
  ...feedLibraryExtJSON.feeds,
  ...feedLibraryExt2JSON.feeds,
  ...feedLibraryExt3JSON.feeds
];

function findFeed(nameKeyword) {
  const feed = allFeeds.find(f => f.name.toLowerCase().includes(nameKeyword.toLowerCase()));
  if (!feed) throw new Error(`Feed not found: ${nameKeyword}`);
  return feed;
}

const feeds = {
  cornSilage: findFeed('Mısır Silajı'),
  alfalfa: findFeed('Yonca Kuru Otu'),
  cornGrain: findFeed('Mısır Tane (Kaba Öğütülmüş)'),
  soybeanMeal: findFeed('Soya Küspesi'),
  cottonseed: findFeed('Pamuk Tohumu'),
  straw: findFeed('Buğday Samanı'),
  canola: findFeed('Kanola Küspesi')
};

const scenarios = [
  {
    name: 'Senaryo 1: Yüksek Verimli Erken Laktasyon (Holstein)',
    animal: {
      breed: 'Holstein', lactationStage: 'early', bw: 650, milkYield: 45, milkFat: 3.8, milkProtein: 3.2,
      dim: 40, parity: 2, bcs: 3.0, pregnant: false, pregnancyMonth: 0, ambientTemp: 20, humidity: 50
    },
    ration: [
      { feed: feeds.cornSilage, kgDM: 8.0 },
      { feed: feeds.alfalfa, kgDM: 4.0 },
      { feed: feeds.cornGrain, kgDM: 6.0 },
      { feed: feeds.soybeanMeal, kgDM: 4.0 },
      { feed: feeds.cottonseed, kgDM: 2.0 },
      { feed: feeds.canola, kgDM: 1.5 }
    ]
  },
  {
    name: 'Senaryo 2: Orta Verimli Orta Laktasyon (Holstein)',
    animal: {
      breed: 'Holstein', lactationStage: 'mid', bw: 680, milkYield: 30, milkFat: 3.6, milkProtein: 3.2,
      dim: 150, parity: 2, bcs: 3.25, pregnant: true, pregnancyMonth: 3, ambientTemp: 20, humidity: 50
    },
    ration: [
      { feed: feeds.cornSilage, kgDM: 10.0 },
      { feed: feeds.alfalfa, kgDM: 3.0 },
      { feed: feeds.cornGrain, kgDM: 4.0 },
      { feed: feeds.soybeanMeal, kgDM: 2.0 },
      { feed: feeds.canola, kgDM: 1.0 }
    ]
  },
  {
    name: 'Senaryo 3: Yakın Kuru Dönem (Close-up Holstein)',
    animal: {
      breed: 'Holstein', lactationStage: 'close_up', bw: 700, milkYield: 0, milkFat: 0, milkProtein: 0,
      dim: 0, parity: 2, bcs: 3.5, pregnant: true, pregnancyMonth: 9, ambientTemp: 20, humidity: 50
    },
    ration: [
      { feed: feeds.cornSilage, kgDM: 5.0 },
      { feed: feeds.straw, kgDM: 4.0 },
      { feed: feeds.soybeanMeal, kgDM: 1.5 },
      { feed: feeds.cornGrain, kgDM: 2.0 }
    ]
  },
  {
    name: 'Senaryo 4: Büyüyen Düve (15 Aylık)',
    animal: {
      breed: 'Holstein', lactationStage: 'heifer', bw: 380, targetADG: 0.8, milkYield: 0, milkFat: 0, milkProtein: 0,
      dim: 0, parity: 0, bcs: 3.0, pregnant: false, pregnancyMonth: 0, ambientTemp: 20, humidity: 50
    },
    ration: [
      { feed: feeds.cornSilage, kgDM: 4.0 },
      { feed: feeds.straw, kgDM: 2.5 },
      { feed: feeds.alfalfa, kgDM: 1.0 },
      { feed: feeds.soybeanMeal, kgDM: 0.5 }
    ]
  },
  {
    name: 'Senaryo 5: Yüksek Verimli Jersey',
    animal: {
      breed: 'Jersey', lactationStage: 'peak', bw: 450, milkYield: 30, milkFat: 5.0, milkProtein: 3.8,
      dim: 100, parity: 2, bcs: 3.0, pregnant: false, pregnancyMonth: 0, ambientTemp: 20, humidity: 50
    },
    ration: [
      { feed: feeds.cornSilage, kgDM: 6.0 },
      { feed: feeds.alfalfa, kgDM: 3.0 },
      { feed: feeds.cornGrain, kgDM: 5.0 },
      { feed: feeds.soybeanMeal, kgDM: 3.0 },
      { feed: feeds.cottonseed, kgDM: 1.5 }
    ]
  }
];

let markdownOutput = `# NDS / AMTS ve Rasyon App Yan-Yana Doğrulama Raporu

Bu döküman, Rasyon App'in (v6.5) hesaplama motorunun sonuçlarını NDS veya AMTS gibi ticari yazılımlarla kıyaslamak için tasarlanmıştır.

## Test Yöntemi
1. Aşağıda belirtilen **5 farklı senaryo** için hayvan bilgilerini ve rasyon formüllerini (Kuru Madde üzerinden kg olarak) NDS veya AMTS programına girin.
2. Yazılımın ayarlarından hesaplama modelini **CNCPS v6.5.5** (veya eşdeğeri) olarak seçin.
3. Çıkan sonuçları (NEL Gereksinimi, MP Gereksinimi, Tahmini KMT vb.) tablodaki "AMTS / NDS" kolonuna yazın.
4. "Fark (%)" kolonunu hesaplayarak sistematik bir sapma olup olmadığını not edin.

---

`;

async function runAll() {
  for (const s of scenarios) {
    const inputFeeds = s.ration.map(item => ({ ...item.feed, pricePerTon: 1000 }));
    const feedLimits = {};
    s.ration.forEach(item => {
      feedLimits[item.feed.id] = { min: item.kgDM, max: item.kgDM, type: 'continuous' };
    });
    
    const reqs = { dmiMethod: 'nrc2001', energyModel: 'cncps', proteinModel: 'cncps' }; // default settings
    
    let result;
    try {
      result = await optimizeRation({ animal: s.animal, feeds: inputFeeds, feedLimits: feedLimits, requirements: reqs, dmiMethod: 'nrc2001', useCNCPS: true });
    } catch (err) {
      console.error('Scenario failed', s.name, err);
      continue;
    }
    
    markdownOutput += `### ${s.name}\n\n`;
    markdownOutput += `**Hayvan:** ${s.animal.breed}, ${s.animal.bw} kg BW, ${s.animal.milkYield}L Süt (%${s.animal.milkFat} Yağ, %${s.animal.milkProtein} Prot), ${s.animal.dim} DIM\n`;
    markdownOutput += `**Rasyon:**\n`;
    for (const item of s.ration) {
      markdownOutput += `- ${item.feed.name}: ${item.kgDM.toFixed(1)} kg KM\n`;
    }
    
    markdownOutput += `\n**Rasyon App Hesaplamaları:**\n\n`;
    markdownOutput += `| Metrik | Rasyon App | AMTS / NDS | Fark (%) | Yorum |\n`;
    markdownOutput += `|--------|------------|------------|----------|-------|\n`;
    markdownOutput += `| Tahmini KMT Sınırı (kg) | ${result.dmi.target_kg.toFixed(2)} | | | |\n`;
    markdownOutput += `| Rasyon Toplam KMT (kg) | ${result.items.reduce((s,f) => s + f.dmKg, 0).toFixed(2)} | | | |\n`;
    markdownOutput += `| NEL Gereksinimi (Mcal) | ${result.requirements.nel.total.toFixed(2)} | | | |\n`;
    markdownOutput += `| NEL Sağlanan (Mcal) | ${result.composition.nel_mcal.toFixed(2)} | | | |\n`;
    markdownOutput += `| MP Gereksinimi (g) | ${result.requirements.mp.total.toFixed(0)} | | | |\n`;
    markdownOutput += `| MP Sağlanan (g) | ${result.composition.mp_g.toFixed(0)} | | | |\n`;
    markdownOutput += `| Ca Gereksinimi (g) | ${result.requirements.minerals.ca.dietary.toFixed(0)} | | | |\n`;
    markdownOutput += `| Ca Sağlanan (g) | ${result.composition.ca_g.toFixed(0)} | | | |\n`;
    
    markdownOutput += `| Toplam Rasyon NDF (%) | ${result.composition.ndf_pct.toFixed(1)} | | | |\n`;
    markdownOutput += `| Rumen pH Tahmini | ${result.rumenDynamics?.dailyMean?.toFixed(2) || 'N/A'} | | | |\n`;
    markdownOutput += `| Metan Tahmini (g/gün) | ${result.methane?.production_g?.toFixed(0) || 'N/A'} | | | |\n`;
    
    markdownOutput += `\n---\n\n`;
  }

  fs.writeFileSync(path.join(process.cwd(), 'NDS_AMTS_Karsilastirma.md'), markdownOutput);
  console.log('Report generated at NDS_AMTS_Karsilastirma.md');
}

runAll();
