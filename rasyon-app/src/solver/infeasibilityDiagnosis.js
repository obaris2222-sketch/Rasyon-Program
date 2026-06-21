/**
 * Infeasibility Tanı — IIS-benzeri çelişen kısıt tespiti (FAZ 14.9, Aşama 1)
 *
 * Problem: glpk.js IIS (Irreducible Infeasible Subset) desteklemez. Bir rasyon LP'si
 * infeasible olduğunda kullanıcı "hangi kısıtlar BİRBİRİYLE çelişiyor" bilmez.
 * FAZ 14.8 soft constraint "hangi kısıt ne kadar gevşedi" der; bu modül daha derin
 * tanı yapar: çelişkiye neden olan MİNİMAL kısıt kümesini bulur.
 *
 * IIS = İndirgenemez İnfizibil Altküme: birlikte infeasibility'ye yol açan minimal
 * kısıt kümesi. Bu kümeden HERHANGİ bir kısıt çıkarılırsa altküme feasible olur
 * (irreducible/indirgenemez özelliği).
 *
 * Algoritma: Deletion Filtering (klasik IIS yöntemi)
 *   1. Aday kısıtlar = tüm subjectTo (yapısal DMI hariç)
 *   2. Her aday kısıt c için:
 *        - c'yi (ve önceden gereksiz bulunanları) çıkar, LP'yi çöz
 *        - Hâlâ infeasible → c gereksiz (IIS'te DEĞİL), kalıcı çıkar
 *        - Feasible oldu → c çelişkinin parçası (IIS'te kalır)
 *   3. Kalan kümeyi döndür (minimal IIS)
 *
 * Maliyet: O(n) LP çözümü (n = aday kısıt sayısı, ~25-35). Yalnızca tam infeasible
 * durumda çağrılır (nadir); Worker thread'inde UI bloklamadan çalışır.
 */

// ─── Kısıt adı → insan-okunabilir Türkçe etiket ──────────────────────────────
const CONSTRAINT_LABELS = {
  DMI: 'Kuru madde tüketimi (KMT)',
  NEL: 'NEL (enerji)',
  CP: 'Ham protein (CP)',
  RUP_min: 'RUP (bypass protein) min',
  RDP: 'RDP (yıkılabilir protein)',
  MP: 'MP (metabolik protein)',
  NDF: 'NDF (lif)',
  ADF_min: 'ADF min',
  NFC_max: 'NFC max',
  Starch_max: 'Nişasta max',
  Sugar_max: 'Şeker max',
  Fat_max: 'Yağ max',
  PUFA_max: 'PUFA (çoklu doymamış yağ) max',
  n6n3_ratio: 'ω6:ω3 oranı',
  peNDF_min: 'peNDF (etkin lif) min',
  Forage: 'Kaba yem oranı',
  DCAD: 'DCAD (katyon-anyon dengesi)',
  Ca: 'Kalsiyum (Ca)',
  P: 'Fosfor (P)',
  Mg: 'Magnezyum (Mg)',
  K: 'Potasyum (K)',
  Na: 'Sodyum (Na)',
  Cl: 'Klor (Cl)',
  S: 'Kükürt (S)',
  Lys: 'Lizin (Lys)',
  Met: 'Metiyonin (Met)',
};

/**
 * Bir kısıt adını Türkçe etikete çevirir (prefix'li kısıtlar dahil).
 */
function labelFor(name) {
  if (CONSTRAINT_LABELS[name]) return CONSTRAINT_LABELS[name];
  if (name.startsWith('trace_')) return `İz mineral: ${name.slice(6)}`;
  if (name.startsWith('vit_')) return `Vitamin: ${name.slice(4)}`;
  if (name.startsWith('group_')) return `Yem grubu: ${name.slice(6)}`;
  if (name.startsWith('limit_')) return `Yem limiti: ${name.slice(6)}`;
  return name;
}

/**
 * Bir kısıtın yön/sınır özetini metne çevirir (DCAD min −15 gibi).
 */
function boundSummary(bnds, GLP) {
  if (!bnds) return '';
  const { type, lb, ub } = bnds;
  // GLP enjekte edilmezse sayısal tipler kullanılır (lpBuilder.GLP ile aynı)
  const T = GLP || { LO: 2, UP: 3, DB: 4, FX: 5 };
  if (type === T.LO) return `min ${round(lb)}`;
  if (type === T.UP) return `max ${round(ub)}`;
  if (type === T.DB) return `${round(lb)}–${round(ub)} aralığı`;
  if (type === T.FX) return `= ${round(lb)}`;
  return '';
}

function round(v) {
  if (v === undefined || v === null || !Number.isFinite(v)) return '?';
  return Math.round(v * 100) / 100;
}

/**
 * LP'nin belirli indekslerdeki kısıtları olmadan kopyasını üretir.
 * @param {object} lp
 * @param {Set<number>} excludeIdx — çıkarılacak subjectTo indeksleri
 * @returns {object} yeni LP (objective/bounds/_meta paylaşılır — çözüm için yeterli)
 */
function buildLPWithout(lp, excludeIdx) {
  return {
    ...lp,
    subjectTo: lp.subjectTo.filter((_, i) => !excludeIdx.has(i)),
  };
}

/**
 * Infeasible LP'de çelişen minimal kısıt kümesini (IIS) bulur.
 *
 * @param {object} lp — buildRationLP() çıktısı (infeasible olduğu varsayılır)
 * @param {function} solve — async (lp) => { optimal, statusName, ... } (solveLP veya mock)
 * @param {object} [options]
 *   @param {string[]} [options.keepConstraints=['DMI']] — IIS'ten muaf yapısal kısıtlar
 *   @param {object}   [options.GLP] — GLP sabitleri (boundSummary için; opsiyonel)
 *   @param {number}   [options.maxConstraints=60] — güvenlik: bu sayıdan fazla kısıtta atla
 * @returns {Promise<{ iis: string[], constraints: Array<{name,label,bound}>, reducible: boolean }>}
 *   iis: çelişen kısıt adları; reducible=false ise yapısal sorun (adaylar yetersiz)
 */
export async function findIIS(lp, solve, options = {}) {
  const {
    keepConstraints = ['DMI'],
    GLP = null,
    maxConstraints = 60,
  } = options;

  const subjectTo = lp.subjectTo || [];
  const keepSet = new Set(keepConstraints);

  // Aday kısıt indeksleri (yapısal olanlar hariç)
  const candidateIdx = [];
  for (let i = 0; i < subjectTo.length; i++) {
    if (!keepSet.has(subjectTo[i].name)) candidateIdx.push(i);
  }

  // Güvenlik: çok büyük problemde IIS pahalı — boş dön (entegrasyon graceful)
  if (candidateIdx.length === 0 || candidateIdx.length > maxConstraints) {
    return { iis: [], constraints: [], reducible: false };
  }

  // Ön-kontrol 0: LP zaten feasible ise çelişki yok (algoritma infeasible varsayar).
  // Bu olmadan deletion filtering feasible LP'de her kısıtı yanlışlıkla IIS'e koyar.
  const fullSol = await solve(lp);
  if (fullSol.optimal) {
    return { iis: [], constraints: [], reducible: true };
  }

  // Ön-kontrol: tüm aday kısıtlar çıkarıldığında (sadece keep kalınca) feasible mi?
  // Değilse çelişki yapısal kısıtlarda/bounds'ta → deletion filtering anlamsız.
  const allRemoved = new Set(candidateIdx);
  const baseSol = await solve(buildLPWithout(lp, allRemoved));
  if (!baseSol.optimal) {
    // Adaylar yetersiz: çelişki keep (DMI) + bounds kaynaklı (pratikte nadir/yapısal)
    return { iis: [], constraints: [], reducible: false };
  }

  // ─── Deletion Filtering ────────────────────────────────────────────────
  const removed = new Set();  // gereksiz bulunan (IIS'te olmayan) indeksler
  for (const idx of candidateIdx) {
    const trialExclude = new Set(removed);
    trialExclude.add(idx);
    const sol = await solve(buildLPWithout(lp, trialExclude));
    if (!sol.optimal) {
      // idx olmadan da infeasible → idx çelişki için GEREKLİ DEĞİL
      removed.add(idx);
    }
    // else: idx kritik (çıkarınca feasible oluyor) → IIS'te kalır
  }

  const iisIdx = candidateIdx.filter(i => !removed.has(i));
  const iis = iisIdx.map(i => subjectTo[i].name);
  const constraints = iisIdx.map(i => ({
    name: subjectTo[i].name,
    label: labelFor(subjectTo[i].name),
    bound: boundSummary(subjectTo[i].bnds, GLP),
  }));

  return { iis, constraints, reducible: true };
}

/**
 * IIS sonucunu insan-okunabilir Türkçe açıklamaya çevirir (UI/rapor için).
 *
 * @param {object} iisResult — findIIS() çıktısı
 * @returns {{ summary: string, items: Array<{name,label,bound,text}> }}
 */
export function describeIIS(iisResult) {
  const { iis = [], constraints = [], reducible } = iisResult || {};

  if (!reducible) {
    return {
      summary: 'Çelişki yapısal kısıtlardan kaynaklanıyor (KMT/yem sınırları). Yem seçimini veya KMT hedefini gözden geçirin.',
      items: [],
    };
  }
  if (iis.length === 0) {
    return { summary: 'Belirgin bir çelişen kısıt kümesi bulunamadı.', items: [] };
  }

  const items = constraints.map(c => ({
    ...c,
    text: c.bound ? `${c.label} (${c.bound})` : c.label,
  }));

  const list = items.map(i => i.text).join(' · ');
  const summary = iis.length === 1
    ? `Tek başına karşılanamayan kısıt: ${items[0].text}. Bu hedefi gevşetin veya uygun yem ekleyin.`
    : `Şu ${iis.length} kısıt birlikte çelişiyor: ${list}. Bunlardan en az birini gevşetmek rasyonu uygulanabilir kılar.`;

  return { summary, items };
}

export { CONSTRAINT_LABELS, labelFor };
