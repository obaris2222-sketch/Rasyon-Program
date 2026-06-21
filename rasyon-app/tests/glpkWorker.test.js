/**
 * glpkWorker.js — Worker singleton + main thread fallback entegrasyon testleri (FAZ 14.1)
 *
 * Node ortamında gerçek Worker global'i yok. Bu nedenle:
 *  - Factory enjeksiyonu (`_setSolverWorkerFactory`) ile FakeWorker stub kullanılır
 *  - Worker yokken main thread fallback davranışı doğrulanır
 *  - Worker hata fırlatınca fallback'in devreye girdiği test edilir
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSolverWorker,
  optimizeViaWorker,
  getSharedSolverWorker,
  resetSharedSolverWorker,
  _setSolverWorkerFactory,
} from '../src/solver/glpkWorker.js';

// ─── Test verisi (rationOptimizer.test.js'ten kısaltılmış set) ────────────────

const FEEDS = [
  { id: 'corn_silage', name: 'Mısır Silajı', category: 'roughage',
    dm: 33, nel: 1.72, cp: 8.2, rup: 15, rdp: 85, ndf: 44, adf: 27, aNDF: 42, nfc: 36,
    fat: 3.3, ash: 4.3, ca: 0.24, p: 0.22, mg: 0.15, k: 1.05, na: 0.01, s: 0.11, cl: 0.09,
    pricePerTon: 2500 },
  { id: 'alfalfa_hay', name: 'Yonca Kuru Otu', category: 'roughage',
    dm: 89, nel: 1.30, cp: 18, rup: 20, rdp: 80, ndf: 42, adf: 32, aNDF: 39, nfc: 25,
    fat: 2, ash: 11, ca: 1.45, p: 0.30, mg: 0.32, k: 2.50, na: 0.10, s: 0.27, cl: 0.40,
    pricePerTon: 6000 },
  { id: 'corn_grain', name: 'Mısır Tane', category: 'grain',
    dm: 88, nel: 2.0, cp: 9, rup: 50, rdp: 50, ndf: 10, adf: 3, aNDF: 8, nfc: 74,
    fat: 4, ash: 1.4, ca: 0.02, p: 0.28, mg: 0.10, k: 0.38, na: 0.01, s: 0.10, cl: 0.05,
    pricePerTon: 9000 },
  { id: 'soybean_meal', name: 'Soya Küspesi', category: 'protein',
    dm: 89, nel: 1.99, cp: 48, rup: 35, rdp: 65, ndf: 10, adf: 5, aNDF: 8, nfc: 28,
    fat: 1.5, ash: 7, ca: 0.33, p: 0.70, mg: 0.30, k: 2.20, na: 0.02, s: 0.45, cl: 0.04,
    pricePerTon: 18000 },
  { id: 'limestone', name: 'Kireçtaşı', category: 'mineral',
    dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
    ca: 38, p: 0, mg: 0.35, k: 0, na: 0, s: 0, cl: 0, pricePerTon: 3000 },
  { id: 'dcp', name: 'DCP', category: 'mineral',
    dm: 97, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
    ca: 22, p: 18, mg: 0.6, k: 0, na: 0.10, s: 0.80, cl: 0, pricePerTon: 15000 },
  { id: 'salt', name: 'Tuz', category: 'mineral',
    dm: 99, nel: 0, cp: 0, ndf: 0, adf: 0, aNDF: 0, nfc: 0, fat: 0, ash: 100,
    ca: 0, p: 0, mg: 0, k: 0, na: 39, s: 0, cl: 60, pricePerTon: 2000 },
];

const HOLSTEIN = {
  bw: 600, parity: 2, dim: 60,
  milkYield: 35, milkFat: 3.7, milkProtein: 3.2, milkLactose: 4.8,
  bcs: 3.0, targetBcs: 3.0, pregnant: false, gestDays: 0, dailyWalkKm: 0,
};

const DEFAULT_LIMITS = {
  alfalfa_hay:  { maxPct: 40 },
  corn_silage:  { maxPct: 40, minPct: 15 },
  corn_grain:   { maxPct: 35 },
  soybean_meal: { maxPct: 25 },
  salt:         { maxPct: 1 },
};

// ─── FakeWorker — Node ortamı için Worker stub ───────────────────────────────

/**
 * Worker arayüzünü mock'lar. Mesajları yapılandırılabilir bir handler'a iletir.
 *
 *   const fake = new FakeWorker({
 *     onMessage: async ({id, type, payload}) => ({ id, ok: true, result: ... })
 *   });
 *
 * onMessage `undefined` döndürürse cevap gönderilmez (timeout testi için).
 * `throw` veya `Error` dönerse `error` event fire edilir.
 */
class FakeWorker {
  constructor({ onMessage } = {}) {
    this.listeners = { message: [], error: [], messageerror: [] };
    this.onMessage = onMessage;
    this.terminated = false;
  }
  addEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type].push(fn);
  }
  _emit(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }
  async postMessage(msg) {
    if (this.terminated) throw new Error('Worker terminated');
    if (!this.onMessage) return;
    queueMicrotask(async () => {
      try {
        const reply = await this.onMessage(msg);
        if (reply === undefined) return;
        if (reply instanceof Error) {
          this._emit('error', { message: reply.message });
          return;
        }
        this._emit('message', { data: reply });
      } catch (err) {
        this._emit('error', { message: err.message });
      }
    });
  }
  terminate() {
    this.terminated = true;
    this.listeners = { message: [], error: [], messageerror: [] };
  }
}

// ─── Testler ─────────────────────────────────────────────────────────────────

describe('createSolverWorker — FakeWorker mesaj akışı', () => {
  it('optimize mesajı echo yanıtı ile resolve olur', async () => {
    let received;
    const fake = new FakeWorker({
      onMessage: (msg) => {
        received = msg;
        return { id: msg.id, ok: true, result: { feasible: true, marker: 'fake' } };
      },
    });
    const w = createSolverWorker({ worker: fake });
    const r = await w.optimize({ animal: HOLSTEIN, feeds: FEEDS });
    expect(r).toEqual({ feasible: true, marker: 'fake' });
    expect(received.type).toBe('optimize');
    expect(received.payload.animal).toBe(HOLSTEIN);
  });

  it('ok:false yanıtı Promise\'i reject eder', async () => {
    const fake = new FakeWorker({
      onMessage: (msg) => ({
        id: msg.id, ok: false, error: { message: 'LP infeasible', stack: 'at ...' },
      }),
    });
    const w = createSolverWorker({ worker: fake });
    await expect(w.optimize({ animal: HOLSTEIN, feeds: FEEDS }))
      .rejects.toThrow('LP infeasible');
  });

  it('worker error event tüm pending istekleri reject eder', async () => {
    const fake = new FakeWorker({
      onMessage: () => new Error('Worker runtime crash'),  // Error döndürürse error event fire
    });
    const w = createSolverWorker({ worker: fake });
    await expect(w.optimize({ animal: HOLSTEIN, feeds: FEEDS }))
      .rejects.toThrow('Worker runtime crash');
  });

  it('birden fazla eşzamanlı mesaj doğru id ile eşlenir', async () => {
    const fake = new FakeWorker({
      onMessage: (msg) => ({
        id: msg.id, ok: true, result: { echoId: msg.id, payload: msg.payload.tag },
      }),
    });
    const w = createSolverWorker({ worker: fake });
    const [a, b, c] = await Promise.all([
      w.optimize({ tag: 'A' }),
      w.optimize({ tag: 'B' }),
      w.optimize({ tag: 'C' }),
    ]);
    expect(a.payload).toBe('A');
    expect(b.payload).toBe('B');
    expect(c.payload).toBe('C');
    // ID'ler benzersiz olmalı
    expect(new Set([a.echoId, b.echoId, c.echoId]).size).toBe(3);
  });

  it('terminate sonrası pending istekler reject olur', async () => {
    const fake = new FakeWorker({ onMessage: () => undefined }); // hiç cevap vermiyor
    const w = createSolverWorker({ worker: fake });
    const pending = w.optimize({ animal: HOLSTEIN, feeds: FEEDS });
    w.terminate();
    await expect(pending).rejects.toThrow(/terminated/i);
  });

  it('Worker globali olmadığında URL parametresiz hata fırlatır', () => {
    // Bu test Worker yokken çağrıldığını varsayar — Node default ortam
    expect(() => createSolverWorker()).toThrow(/Worker bu ortamda mevcut değil/);
  });
});

describe('optimizeViaWorker — singleton + fallback', () => {
  beforeEach(() => {
    // Her test temiz singleton ile başlasın
    resetSharedSolverWorker();
    _setSolverWorkerFactory(null);
  });
  afterEach(() => {
    resetSharedSolverWorker();
    _setSolverWorkerFactory(null);
  });

  it('Worker yokken main thread\'de optimizeRation çalıştırır', async () => {
    // Node ortamında Worker global'i yok → fallback gerçek LP çözümü yapar
    const r = await optimizeViaWorker({
      animal: HOLSTEIN, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r).toBeDefined();
    expect(r.feasible).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
    // Worker oluşturulmadı (fallback yolu)
    expect(getSharedSolverWorker()).toBeNull();
  });

  it('factory ile enjekte edilen FakeWorker üzerinden optimize eder', async () => {
    let workerCalls = 0;
    _setSolverWorkerFactory(() => createSolverWorker({
      worker: new FakeWorker({
        onMessage: (msg) => {
          workerCalls++;
          return { id: msg.id, ok: true, result: { feasible: true, viaWorker: true } };
        },
      }),
    }));
    const r = await optimizeViaWorker({ animal: HOLSTEIN, feeds: FEEDS });
    expect(r.viaWorker).toBe(true);
    expect(workerCalls).toBe(1);
    // Singleton: ikinci çağrı aynı worker'ı kullanır
    const r2 = await optimizeViaWorker({ animal: HOLSTEIN, feeds: FEEDS });
    expect(r2.viaWorker).toBe(true);
    expect(workerCalls).toBe(2);
  });

  it('Worker hata atarsa main thread fallback devreye girer', async () => {
    let workerCalls = 0;
    _setSolverWorkerFactory(() => createSolverWorker({
      worker: new FakeWorker({
        onMessage: (msg) => {
          workerCalls++;
          return { id: msg.id, ok: false, error: { message: 'Worker crash' } };
        },
      }),
    }));
    // Worker hata atar → fallback main thread → gerçek LP çözer
    const r = await optimizeViaWorker({
      animal: HOLSTEIN, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r.feasible).toBe(true);
    expect(workerCalls).toBe(1);
    // Worker hata sonrası singleton sıfırlandı, sonraki çağrı yeniden oluşturur
    const r2 = await optimizeViaWorker({
      animal: HOLSTEIN, feeds: FEEDS, feedLimits: DEFAULT_LIMITS,
    });
    expect(r2.feasible).toBe(true);
    expect(workerCalls).toBe(2);  // Yeni worker da hata atar, yine fallback
  });

  it('singleton: aynı worker tekrar tekrar kullanılır', async () => {
    let createCount = 0;
    _setSolverWorkerFactory(() => {
      createCount++;
      return createSolverWorker({
        worker: new FakeWorker({
          onMessage: (msg) => ({ id: msg.id, ok: true, result: { ok: true } }),
        }),
      });
    });
    await optimizeViaWorker({ animal: HOLSTEIN, feeds: FEEDS });
    await optimizeViaWorker({ animal: HOLSTEIN, feeds: FEEDS });
    await optimizeViaWorker({ animal: HOLSTEIN, feeds: FEEDS });
    expect(createCount).toBe(1);  // Worker bir kez oluşturuldu
  });
});
