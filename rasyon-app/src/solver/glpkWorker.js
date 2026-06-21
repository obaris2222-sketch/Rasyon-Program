/**
 * Web Worker — LP optimizasyonu ana iş parçacığını bloklamadan çalıştırır.
 *
 * FAZ 14.1: Singleton + main thread fallback ile UI'dan kullanılır.
 *
 * Kullanım (ana iş parçacığı):
 *   import { optimizeViaWorker } from './glpkWorker.js';
 *   const result = await optimizeViaWorker({ animal, feeds, ... });
 *
 * Worker bu ortamda mevcut değilse otomatik olarak main thread'e düşer
 * (Node test ortamı, eski tarayıcı). Worker'da çözücü hata fırlatırsa da
 * main thread fallback denenir.
 */

import { optimizeRation } from './rationOptimizer.js';
import { buildRationLP } from './lpBuilder.js';
import { solveLP } from './glpkSolver.js';

// ─── Worker context (self) tarafı ────────────────────────────────────────────
// Bu blok sadece Worker içinde çalışır (importScripts veya module worker).

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.addEventListener('message', async (ev) => {
    const { id, type, payload } = ev.data || {};
    try {
      let result;
      switch (type) {
        case 'optimize':
          result = await optimizeRation(payload);
          break;
        case 'solveLP':
          result = await solveLP(payload.lp, payload.opts);
          break;
        case 'buildLP':
          result = buildRationLP(payload);
          break;
        default:
          throw new Error(`Bilinmeyen mesaj tipi: ${type}`);
      }
      self.postMessage({ id, ok: true, result });
    } catch (err) {
      self.postMessage({
        id, ok: false,
        error: { message: err.message, stack: err.stack },
      });
    }
  });
}

// ─── Ana iş parçacığı yardımcısı ─────────────────────────────────────────────

/**
 * Bir Worker örneği üzerinden Promise tabanlı sade bir API döndürür.
 *
 * @param {object|string} [opts] — string verilirse workerUrl olarak işlenir
 *   @param {string|URL} [opts.workerUrl] — Worker dosya URL'i (default: glpkWorker.js)
 *   @param {Worker}     [opts.worker]    — önceden oluşturulmuş Worker (test için)
 * @returns {{ optimize, solveLP, buildLP, terminate }}
 */
export function createSolverWorker(opts) {
  // Geriye uyum: string verilmişse URL olarak işle
  const options = typeof opts === 'string' || opts instanceof URL
    ? { workerUrl: opts }
    : (opts || {});

  let worker;
  if (options.worker) {
    worker = options.worker;
  } else {
    if (typeof Worker === 'undefined') {
      throw new Error('Worker bu ortamda mevcut değil');
    }
    const url = options.workerUrl ?? new URL('./glpkWorker.js', import.meta.url);
    worker = new Worker(url, { type: 'module' });
  }

  const pending = new Map();
  let nextId = 1;

  worker.addEventListener('message', (ev) => {
    const { id, ok, result, error } = ev.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(Object.assign(new Error(error?.message || 'Worker hata'), { stack: error?.stack }));
  });

  function rejectAll(reason) {
    for (const p of pending.values()) p.reject(reason);
    pending.clear();
  }

  worker.addEventListener('error', (e) => {
    rejectAll(Object.assign(new Error(e.message || 'Worker runtime error'), { event: e }));
  });

  // messageerror: structured clone başarısız oldu → mesaj seri.lize edilemedi
  worker.addEventListener('messageerror', (e) => {
    rejectAll(new Error('Worker mesaj seri.lizasyon hatası'));
  });

  function send(type, payload) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, type, payload });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  return {
    optimize: (input) => send('optimize', input),
    solveLP:  (lp, opts) => send('solveLP', { lp, opts }),
    buildLP:  (input) => send('buildLP', input),
    terminate: () => {
      try { worker.terminate(); } catch { /* test stub'larda terminate olmayabilir */ }
      rejectAll(new Error('Worker terminated'));
    },
  };
}

// ─── Singleton + Fallback API (FAZ 14.1) ─────────────────────────────────────

let _sharedWorker = null;
let _workerUnavailable = false;

/**
 * Test/runtime için Worker factory enjeksiyonu.
 * `null` verilirse singleton sıfırlanır ve yeniden denenebilir.
 */
let _workerFactoryOverride = null;
export function _setSolverWorkerFactory(factory) {
  // Var olan singleton'ı temizle (test izolasyonu için)
  if (_sharedWorker) {
    try { _sharedWorker.terminate(); } catch { /* yoksay */ }
  }
  _sharedWorker = null;
  _workerUnavailable = false;
  _workerFactoryOverride = factory;
}

/**
 * Singleton solver worker'ı döndürür. Worker bu ortamda mevcut değilse `null`.
 * İlk başarısızlıkta `_workerUnavailable=true` set edilir — sonraki çağrılarda
 * yeniden denenmez (fallback hızı için).
 */
export function getSharedSolverWorker() {
  if (_workerUnavailable) return null;
  if (_sharedWorker) return _sharedWorker;
  try {
    if (_workerFactoryOverride) {
      _sharedWorker = _workerFactoryOverride();
    } else {
      if (typeof Worker === 'undefined') {
        _workerUnavailable = true;
        return null;
      }
      _sharedWorker = createSolverWorker();
    }
    return _sharedWorker;
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[solver] Worker oluşturulamadı, main thread fallback:', err.message);
    }
    _workerUnavailable = true;
    _sharedWorker = null;
    return null;
  }
}

/**
 * Worker varsa onunla optimize eder, yoksa main thread'de çalışır.
 * Worker çağrısı runtime'da hata verirse fallback main thread denenir.
 *
 * @param {object} input — optimizeRation girdi objesi
 * @returns {Promise<object>} RationResult
 */
export async function optimizeViaWorker(input) {
  const worker = getSharedSolverWorker();
  if (worker) {
    try {
      return await worker.optimize(input);
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[solver] Worker optimize hatası, main thread fallback:', err.message);
      }
      // Bozulmuş worker'ı sıfırla; bir sonraki çağrıda yeniden oluşturulur
      try { worker.terminate(); } catch { /* yoksay */ }
      _sharedWorker = null;
      // Tek seferlik hata; flag set etmiyoruz, sonraki istekte Worker yeniden denenir
    }
  }
  return optimizeRation(input);
}

/**
 * Test/uygulama yaşam döngüsü için singleton'ı temizler.
 */
export function resetSharedSolverWorker() {
  if (_sharedWorker) {
    try { _sharedWorker.terminate(); } catch { /* yoksay */ }
  }
  _sharedWorker = null;
  _workerUnavailable = false;
}
