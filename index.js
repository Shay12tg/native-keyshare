const { BroadcastChannel } = require('node:worker_threads');
const { serialize, deserialize } = require('node:v8');

const READERS_LOCK_BYTES = 4;
const WRITER_LOCK_BYTES = 4;
const LOCK_BYTES = READERS_LOCK_BYTES + WRITER_LOCK_BYTES;
const SIZE_BYTES = 4;
const META_SIZE = LOCK_BYTES + SIZE_BYTES;

const stores = new Map();

class SharedKVStore {
  constructor(storeName = 'default', msgpack = true) {
    this.storeName = storeName;
    this.msgpack = false;

    try {
      if (msgpack) {
        const { Packr, isNativeAccelerationEnabled } = require('msgpackr');
        this.packr = new Packr({
          bundleStrings: false,
          mapsAsObjects: true,
          useRecords: false,
          structuredClone: true,
          maxSharedStructures: 4096,
          shouldShareStructure: struct => struct.length < 64
        });
        this.msgpack = true;
        if (!isNativeAccelerationEnabled) {
          console.error('Native acceleration not enabled');
          // this.packr = null;
        }
      }
    } catch (E) { }
    // this.packr ||= {
    //   pack: (value) => {
    //     const jsonStr = JSON.stringify(value);
    //     const encoder = new TextEncoder();
    //     return encoder.encode(jsonStr);
    //   },
    //   unpack: (buffer) => {
    //     const decoder = new TextDecoder();
    //     const jsonStr = decoder.decode(buffer);
    //     return JSON.parse(jsonStr);
    //   },
    // };
    this.packr ||= {
      pack: serialize,
      unpack: deserialize
    };

    this.storeLockBuffer = new SharedArrayBuffer(LOCK_BYTES);
    this.storeLock = new Int32Array(this.storeLockBuffer);

    this.ttlMap = new Map();
    this.metaBuffers = new Map();
    this.dataBuffers = new Map();

    this.initTimestamp = Date.now();//process.hrtime.bigint();

    this.channel = new BroadcastChannel(`SharedKVStore:${storeName}`);
    this.channel.onmessage = (message) => {
      this.handleMessage(message.data);
    };

    // Broadcast initialization request with timestamp
    this.channel.postMessage({
      action: 'initialize_request',
      timestamp: this.initTimestamp,
    });

    this.interval = setInterval(this.handleTTL.bind(this), 1000);
  }

  handleTTL() {
    let ttlBatch = this.ttlBatch ?? 0;
    if (ttlBatch >= this.ttlMap.size) {
      ttlBatch = 0;
    }
    const now = Date.now();
    const limit = ttlBatch + 250;
    let i = 0;

    for (const [key, ttl] of this.ttlMap.entries()) {
      if (i++ < ttlBatch) {
        continue;
      }

      if (now >= ttl) {
        this._delete(key);
      }

      if (i === limit) {
        break;
      }
    }

    this.ttlBatch = i;
  }

  close() {
    Object.keys(this).forEach(key => delete this[key]);
    clearInterval(this.interval);
    stores.delete(this.storeName);
    this.channel.close();
    this.ttlMap.clear();
    this.dataBuffers.clear();
    this.metaBuffers.clear();
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    try {
      if (
        message.action === 'set' &&
        message.metaBuffer instanceof SharedArrayBuffer &&
        message.dataBuffer instanceof SharedArrayBuffer
      ) {
        this.metaBuffers.set(message.key, message.metaBuffer);
        this.dataBuffers.set(message.key, message.dataBuffer);
        if (message.ttl > 0) {
          this.ttlMap.set(message.key, message.ttl);
        } else {
          this.ttlMap.delete(message.key);
        }
        return;
      }

      if (message.action === 'ttl_set' && message.key) {
        if (typeof message.ttl === 'number' && message.ttl > 0) {
          this.ttlMap.set(message.key, message.ttl);
        } else {
          this.ttlMap.delete(message.key);
        }
        return;
      }

      if (message.action === 'delete') {
        if (message.pattern) {
          this.deletePattern(message.pattern);
        } else if (message.key) {
          this._delete(message.key);
        }
        return;
      }

      if (message.action === 'clear') {
        this._clear();
        return;
      }

      // todo work on the initialization. too much cross talk
      if (message.action === 'initialize_request') {
        // Compare timestamps and respond if the current thread has the latest initialization
        if (message.timestamp > this.initTimestamp) {
          // console.log('initing', this.initTimestamp, timestamp);
          this.channel.postMessage({
            action: 'initialize_response',
            storeLockBuffer: this.storeLockBuffer,
            timestamp: this.initTimestamp,
            keys: Array.from(this.metaBuffers.entries()).map(([key, metaBuffer]) => ({
              key,
              metaBuffer,
              dataBuffer: this.dataBuffers.get(key),
              ttl: this.ttlMap.get(key)
            }))
          });
        }
        return;
      }

      if (message.action === 'initialize_response' && message.timestamp < this.initTimestamp) {
        // Initialize store based on the received state
        if (message.storeLockBuffer instanceof SharedArrayBuffer) {
          // console.log('inited', this.initTimestamp, timestamp);
          this.storeLockBuffer = message.storeLockBuffer;
          this.storeLock = new Int32Array(this.storeLockBuffer);

          // Initialize with existing keys
          if (Array.isArray(message.keys)) {
            for (const { key, metaBuffer, dataBuffer, ttl } of message.keys) {
              if (metaBuffer instanceof SharedArrayBuffer && dataBuffer instanceof SharedArrayBuffer) {
                this.metaBuffers.set(key, metaBuffer);
                this.dataBuffers.set(key, dataBuffer);
                if (ttl) {
                  this.ttlMap.set(key, ttl);
                }
              }
            }
          }
          this.initTimestamp = message.timestamp;
        }
        return;
      }
    } catch (err) {
      console.error(`Error handling message: ${err.message}`);
    }
  }

  acquireStoreLock(timeout = 1000) {
    for (let i = timeout / 10; i > 0; i--) {
      if (Atomics.compareExchange(this.storeLock, 0, 0, 1) === 0) {
        return true;
      }
      Atomics.wait(this.storeLock, 0, 1, 10);
    }
    return false;
  }

  releaseStoreLock() {
    Atomics.store(this.storeLock, 0, 0);
    Atomics.notify(this.storeLock, 0);
  }

  lock(key, timeout = 1000) {
    let meta = this.metaBuffers.get(key);
    return meta && this._acquireLock(meta, true, timeout);
  }

  release(key) {
    let meta = this.metaBuffers.get(key);
    return meta && this._releaseLock(meta, 'rw');
  }

  _acquireLock(metaBuffer, exclusive = false, timeout = 1000) {
    const view = new Int32Array(metaBuffer);
    let i = timeout / 10;

    if (exclusive) {
      for (; i > 0; i--) {
        if (Atomics.compareExchange(view, 1, 0, 1) === 0) {
          break;
        }
        Atomics.wait(view, 1, 1, 10);
      }

      if (i > 0) {
        for (; i > 0; i--) {
          if (Atomics.load(view, 0) === 0) {
            return true;
          }
          Atomics.wait(view, 0, Atomics.load(view, 0), 10);
        }
        Atomics.store(view, 1, 0);
        Atomics.notify(view, 1);
      }
    } else {
      for (; i > 0; i--) {
        Atomics.add(view, 0, 1);
        if (Atomics.load(view, 1) === 0) {
          return true;
        }
        Atomics.sub(view, 0, 1);
        Atomics.wait(view, 1, 1, 10);
      }
    }
    return false;
  }

  _releaseLock(metaBuffer, mode = 'r') {
    const view = new Int32Array(metaBuffer);

    if (mode === 'r') {
      if (Atomics.sub(view, 0, 1) === 1) {
        Atomics.notify(view, 0);
      }
    } else {
      if (mode === 'rw') {
        Atomics.store(view, 0, 0);
        Atomics.notify(view, 0);
      }
      Atomics.store(view, 1, 0);
      Atomics.notify(view, 1);
    }
  }

  validateKey(key) {
    return typeof key === 'string' && key.length > 0 && key.length <= 512;
  }

  set(key, value, options = {}) {
    if (!this.validateKey(key) || value === undefined) {
      return false;
    }

    let metaBuffer = this.metaBuffers.get(key);
    let dataBuffer = this.dataBuffers.get(key);
    let acquired = false;

    const data = this.packr.pack(value);
    const requiredSize = Math.max(options.minBufferSize ?? 0, data.length);

    try {
      if (metaBuffer && !options.skipLock && !this._acquireLock(metaBuffer, true)) {
        return false;
      }
      acquired = !options.skipLock;

      const reuseBuffer = dataBuffer && !options.immutable && dataBuffer.byteLength >= requiredSize;
      const previousTTL = this.ttlMap.get(key);
      const ttl = options.ttl > 0 ? Date.now() + options.ttl * 1000 : undefined;

      if (ttl !== undefined) {
        this.ttlMap.set(key, Date.now() + options.ttl * 1000);
        if (reuseBuffer) {
          this.channel.postMessage({
            action: 'ttl_set',
            key,
            ttl
          });
        }
      } else if (previousTTL > 0) {
        this.ttlMap.delete(key);
        if (reuseBuffer) {
          this.channel.postMessage({
            action: 'ttl_set',
            key
          });
        }
      }

      if (reuseBuffer) {
        const headerView = new Uint32Array(metaBuffer, LOCK_BYTES, 1);
        headerView[0] = data.length;
        new Uint8Array(dataBuffer, 0, data.length).set(data);
      } else {
        const newMetaBuffer = new SharedArrayBuffer(META_SIZE);
        const newDataBuffer = new SharedArrayBuffer(requiredSize);

        const headerView = new Uint32Array(newMetaBuffer, LOCK_BYTES, 1);
        headerView[0] = data.length;
        new Uint8Array(newDataBuffer, 0, data.length).set(data);

        if (!this.acquireStoreLock()) {
          console.warn('Failed to acquire store lock for broadcast');
          return false;
        }

        try {
          this.metaBuffers.set(key, newMetaBuffer);
          this.dataBuffers.set(key, newDataBuffer);
          this.channel.postMessage({
            action: 'set',
            key,
            metaBuffer: newMetaBuffer,
            dataBuffer: newDataBuffer,
            ttl
          });
        } finally {
          this.releaseStoreLock();
        }
      }

      return true;
    } catch (err) {
      console.error('Set error:', err);
      return false;
    } finally {
      if (acquired && metaBuffer) {
        this._releaseLock(metaBuffer, 'w');
      }
    }
  }

  get(key, skipLock = false) {
    const metaBuffer = this.metaBuffers.get(key);
    const dataBuffer = this.dataBuffers.get(key);
    if (!metaBuffer || !dataBuffer) {
      return undefined;
    }

    if (!skipLock && !this._acquireLock(metaBuffer, false)) {
      console.warn('failed to acquire');
      return undefined;
    }

    try {
      const size = new Uint32Array(metaBuffer, LOCK_BYTES, 1)[0];
      if (size <= 0 || size > dataBuffer.byteLength) {
        console.warn('bad size', size, dataBuffer.byteLength);
        return undefined;
      }

      if (this.msgpack) {
        const data = new Uint8Array(dataBuffer, 0, size);
        // the next line is fastest.. but causes segmentation fault in some cases
        // return this.packr.unpack(data);
        // we'll copy the buffer....
        const arrayBufferCopy = new ArrayBuffer(data.byteLength);
        const arrayBufferView = new Uint8Array(arrayBufferCopy);
        arrayBufferView.set(data);
        return this.packr.unpack(arrayBufferView);
      }

      const data = new DataView(dataBuffer, 0, size);
      return this.packr.unpack(data);
    } catch (err) {
      console.error('Get error:', err);
      return undefined;
    } finally {
      if (!skipLock) {
        this._releaseLock(metaBuffer, 'r');
      }
    }
  }

  clear() {
    let locked = this.acquireStoreLock();
    if (!locked) {
      console.warn('Failed to acquire store lock for broadcast');
      // return;
    }
    try {
      this._clear();
      this.channel.postMessage({
        action: 'clear'
      });
    } finally {
      if (locked) {
        this.releaseStoreLock();
      }
    }
  }

  _clear() {
    this.metaBuffers.clear();
    this.dataBuffers.clear();
    this.ttlMap.clear();
  }

  delete(key, skipLock = false) {
    if (!this.validateKey(key)) {
      return false;
    }

    if (key.includes('*') || key.includes('?') || (key.startsWith('/') && key.endsWith('/'))) {
      return this.deletePattern(key, skipLock);
    }

    const metaBuffer = this.metaBuffers.get(key);
    if (!metaBuffer) {
      return false;
    }

    if (!skipLock && !this._acquireLock(metaBuffer, true)) {
      return false;
    }

    try {
      if (!skipLock && !this.acquireStoreLock()) {
        return false;
      }

      try {
        this._delete(key);
        this.channel.postMessage({
          action: 'delete',
          key
        });
        return true;
      } finally {
        this.releaseStoreLock();
      }
    } finally {
      this._releaseLock(metaBuffer, 'w');
    }
  }

  _delete(key) {
    this.metaBuffers.delete(key);
    this.dataBuffers.delete(key);
    this.ttlMap.delete(key);
  }

  deletePattern(pattern, skipLock = false) {
    let regex;
    try {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        regex = new RegExp(pattern.slice(1, -1));
      } else {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const wildcardPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
        regex = new RegExp(`^${wildcardPattern}$`);
      }
    } catch (e) {
      return false;
    }

    if (!skipLock && !this.acquireStoreLock()) {
      return false;
    }

    try {
      let deleted = false;
      for (const [key, metaBuffer] of this.metaBuffers.entries()) {
        if (regex.test(key)) {
          if (skipLock || this._acquireLock(metaBuffer, true)) {
            try {
              this._delete(key);
              deleted = true;
            } finally {
              if (!skipLock) {
                this._releaseLock(metaBuffer, 'w');
              }
            }
          }
        }
      }

      if (deleted) {
        this.channel.postMessage({
          action: 'delete',
          pattern
        });
      }

      return deleted;
    } finally {
      this.releaseStoreLock();
    }
  }

  listKeys(pattern = null) {
    if (!pattern) {
      return Array.from(this.metaBuffers.keys());
    }

    let regex;
    try {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        regex = new RegExp(pattern.slice(1, -1));
      } else {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const wildcardPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
        regex = new RegExp(`^${wildcardPattern}$`);
      }
    } catch (e) {
      return [];
    }
    return Array.from(this.metaBuffers.keys()).filter(key => regex.test(key));
  }
}

function createStore(storeName = 'default', msgpack = true) {
  if (stores.has(storeName)) {
    return stores.get(storeName);
  }
  const store = new SharedKVStore(storeName, msgpack);
  const wrapper = {
    set: store.set.bind(store),
    get: store.get.bind(store),
    delete: store.delete.bind(store),
    release: store.release.bind(store),
    lock: store.lock.bind(store),
    clear: store.clear.bind(store),
    listKeys: store.listKeys.bind(store),
    close: () => {
      store.close();

      wrapper.get = () => undefined;
      wrapper.set = () => undefined;
      wrapper.delete = () => true;
      wrapper.lock = () => true;
      wrapper.release = () => true;
      wrapper.listKeys = () => [];
      wrapper.clear = () => { };
      wrapper.close = () => { };
    }
  };
  stores.set(storeName, wrapper);
  return wrapper;
}

module.exports = { createStore };