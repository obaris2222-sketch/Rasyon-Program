/**
 * glpk.js Sarmalayıcısı — LP/MILP çözücü
 *
 * Hem Node (test) hem tarayıcı (Worker) ortamında çalışır.
 * glpk.js modülü async başlatılır → solver singleton önbelleğe alınır.
 */

import { GLP } from './lpBuilder.js';

let _glpkPromise = null;

/**
 * glpk.js modülünü yükle ve çözücü örneğini döndür (singleton).
 * @returns {Promise<object>} glpk solver instance
 */
export async function getGLPK() {
  if (_glpkPromise) return _glpkPromise;
  _glpkPromise = (async () => {
    const mod = await import('glpk.js');
    const factory = mod.default || mod;
    const glpk = await factory();
    return glpk;
  })();
  return _glpkPromise;
}

/**
 * LP problemini çöz.
 * @param {object} lp — buildRationLP() çıktısı
 * @param {object} [opts]
 *   @param {number} [opts.msglev=0]  — mesaj seviyesi (0=off, 4=all)
 *   @param {boolean} [opts.presol=true]
 *   @param {number} [opts.tmlim]     — saniye cinsinden süre limiti
 * @returns {Promise<object>} { status, optimal, z, vars, message, raw }
 */
export async function solveLP(lp, opts = {}) {
  const glpk = await getGLPK();

  // GLP sabitleri lpBuilder'da kendi kopyasıyla yazıldı —
  // gerçek glpk örneğinin sabitlerini eşitle
  const fixed = remapGLPConstants(lp, glpk);

  const options = {
    msglev: opts.msglev ?? glpk.GLP_MSG_OFF,
    presol: opts.presol ?? true,
  };
  if (opts.tmlim !== undefined) options.tmlim = opts.tmlim;

  if (typeof process !== 'undefined' && process.env.DEBUG_GLPK) {
    const fs = await import('fs');
    fs.writeFileSync('lp_dump.json', JSON.stringify(fixed, null, 2));
  }

  const raw = await glpk.solve(fixed, options);
  const status = raw.result.status;
  const optimal = status === glpk.GLP_OPT;

  return {
    status,
    statusName: statusName(status, glpk),
    optimal,
    z: raw.result.z,
    vars: raw.result.vars,
    message: optimal
      ? 'Optimal çözüm bulundu'
      : statusToMessage(status, glpk),
    raw,
  };
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function remapGLPConstants(lp, glpk) {
  // lpBuilder kendi GLP sabitleriyle inşa eder; gerçek glpk değerlerine eşle
  const LOCAL_TO_REAL = {
    [GLP.MIN]: glpk.GLP_MIN, [GLP.MAX]: glpk.GLP_MAX,
    [GLP.FR]:  glpk.GLP_FR,  [GLP.LO]:  glpk.GLP_LO,
    [GLP.UP]:  glpk.GLP_UP,  [GLP.DB]:  glpk.GLP_DB,
    [GLP.FX]:  glpk.GLP_FX,
  };
  // Yön
  const objective = {
    ...lp.objective,
    direction: LOCAL_TO_REAL[lp.objective.direction] ?? glpk.GLP_MIN,
  };
  // Kısıt tipleri
  const subjectTo = lp.subjectTo.map(c => ({
    ...c,
    bnds: { ...c.bnds, type: LOCAL_TO_REAL[c.bnds.type] ?? c.bnds.type },
  }));
  const result = { ...lp, objective, subjectTo };
  // Değişken sınırları (bounds) — FAZ 13.4: type'ları gerçek glpk sabitlerine eşle.
  // lp.bounds yoksa anahtar eklenmez (geriye uyumluluk).
  if (Array.isArray(lp.bounds)) {
    result.bounds = lp.bounds.map(b => ({
      ...b,
      type: LOCAL_TO_REAL[b.type] ?? b.type,
    }));
  }
  return result;
}

function statusName(status, glpk) {
  switch (status) {
    case glpk.GLP_OPT:    return 'optimal';
    case glpk.GLP_FEAS:   return 'feasible';
    case glpk.GLP_INFEAS: return 'infeasible';
    case glpk.GLP_NOFEAS: return 'no_feasible';
    case glpk.GLP_UNBND:  return 'unbounded';
    case glpk.GLP_UNDEF:  return 'undef';
    default:              return `unknown(${status})`;
  }
}

function statusToMessage(status, glpk) {
  switch (status) {
    case glpk.GLP_FEAS:   return 'Fizibil ama optimal değil (presolve sınırı)';
    case glpk.GLP_INFEAS: return 'Çözüm fizibil değil — kısıtlar çelişiyor';
    case glpk.GLP_NOFEAS: return 'Hiçbir fizibil çözüm yok';
    case glpk.GLP_UNBND:  return 'Amaç sınırsız — kısıt eksik';
    case glpk.GLP_UNDEF:  return 'Çözüm tanımsız';
    default:              return `Bilinmeyen durum: ${status}`;
  }
}
