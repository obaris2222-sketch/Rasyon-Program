/**
 * Vitest setup — fake-indexeddb ile Node ortamında IndexedDB simülasyonu.
 * idb kütüphanesinin ihtiyaç duyduğu tüm global IDB sınıflarını ayarlar.
 */
import {
  IDBFactory, IDBDatabase, IDBObjectStore, IDBIndex,
  IDBTransaction, IDBRequest, IDBOpenDBRequest, IDBCursor,
  IDBCursorWithValue, IDBKeyRange, IDBVersionChangeEvent,
} from 'fake-indexeddb';

// Tüm IDB global'larını Node ortamında kullanılabilir kıl
globalThis.IDBFactory            = IDBFactory;
globalThis.IDBDatabase           = IDBDatabase;
globalThis.IDBObjectStore        = IDBObjectStore;
globalThis.IDBIndex              = IDBIndex;
globalThis.IDBTransaction        = IDBTransaction;
globalThis.IDBRequest            = IDBRequest;
globalThis.IDBOpenDBRequest      = IDBOpenDBRequest;
globalThis.IDBCursor             = IDBCursor;
globalThis.IDBCursorWithValue    = IDBCursorWithValue;
globalThis.IDBKeyRange           = IDBKeyRange;
globalThis.IDBVersionChangeEvent = IDBVersionChangeEvent;

// Her test dosyası temiz bir IDBFactory ile başlar
globalThis.indexedDB = new IDBFactory();
