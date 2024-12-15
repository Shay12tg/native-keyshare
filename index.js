const { BroadcastChannel } = require('node:worker_threads');

const stores = new Map();
const LOCK_BYTES = 4;    // 32 bits for lock
const SIZE_BYTES = 4;    // 32 bits for size
const META_SIZE = LOCK_BYTES + SIZE_BYTES;

class SharedKVStore {
  constructor(storeName = 'default', msgpack = false) {
    this.storeName = storeName;
    this.msgpack = msgpack;

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
        if (!isNativeAccelerationEnabled) {
          console.error('Native acceleration not enabled - fallback to json');
          this.packr = null;
        }
      }
    } catch (E) { }
    this.packr ||= {
      pack: (value) => {
        const jsonStr = JSON.stringify(value);
        const encoder = new TextEncoder();
        return encoder.encode(jsonStr);
      },
      unpack: (buffer) => {
        const decoder = new TextDecoder();
        const jsonStr = decoder.decode(buffer);
        return JSON.parse(jsonStr);
      },
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
        this.metaBuffers.delete(key);
        this.dataBuffers.delete(key);
        this.ttlMap.delete(key);
      }

      if (i === limit) {
        break;
      }
    }

    this.ttlBatch = i;
  }

  close() {
    this.ttlMap.clear();
    this.dataBuffers.clear();
    this.metaBuffers.clear();
    this.channel.close();
    clearInterval(this.interval);
    stores.delete(this.storeName);
    Object.keys(this).forEach(key => delete this[key]);
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
          this.metaBuffers.delete(message.key);
          this.dataBuffers.delete(message.key);
        }
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
              dataBuffer: this.dataBuffers.get(key)
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
            for (const { key, metaBuffer, dataBuffer } of message.keys) {
              if (metaBuffer instanceof SharedArrayBuffer && dataBuffer instanceof SharedArrayBuffer) {
                this.metaBuffers.set(key, metaBuffer);
                this.dataBuffers.set(key, dataBuffer);
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

  acquireLock(metaBuffer, isWrite = false) {
    const lockView = new Int32Array(metaBuffer, 0, 1);

    while (true) {
      const current = Atomics.load(lockView, 0);
      if (isWrite) {
        if (current === 0 && Atomics.compareExchange(lockView, 0, 0, -1) === 0) {
          return true;
        }
      } else {
        if (current >= 0 && Atomics.compareExchange(lockView, 0, current, current + 1) === current) {
          return true;
        }
      }
      Atomics.wait(lockView, 0, current, 10);
    }
  }

  releaseLock(metaBuffer, isWrite = false) {
    const lockView = new Int32Array(metaBuffer, 0, 1);
    if (isWrite) {
      Atomics.store(lockView, 0, 0);
    } else {
      Atomics.sub(lockView, 0, 1);
    }
    Atomics.notify(lockView, 0);
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
    let acquiredStore = false;

    const data = this.packr.pack(value);
    const requiredSize = Math.max(options.minBufferSize ?? 0, data.length);

    try {
      if (metaBuffer && !this.acquireLock(metaBuffer)) {
        return false;
      }
      acquired = true;

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
        acquiredStore = true;

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
          if (acquiredStore) {
            this.releaseStoreLock();
          }
        }
      }

      return true;
    } catch (err) {
      console.error('Set error:', err);
      return false;
    } finally {
      if (acquired && metaBuffer) {
        this.releaseLock(metaBuffer);
      }
    }
  }

  get(key) {
    const metaBuffer = this.metaBuffers.get(key);
    const dataBuffer = this.dataBuffers.get(key);
    if (!metaBuffer || !dataBuffer) {
      return undefined;
    }

    if (!this.acquireLock(metaBuffer)) {
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
      this.releaseLock(metaBuffer);
    }
  }

  delete(key) {
    if (!this.validateKey(key)) {
      return false;
    }

    if (key.includes('*') || key.includes('?') || (key.startsWith('/') && key.endsWith('/'))) {
      return this.deletePattern(key);
    }

    const metaBuffer = this.metaBuffers.get(key);
    if (!metaBuffer) {
      return false;
    }

    if (!this.acquireLock(metaBuffer)) {
      return false;
    }

    try {
      if (!this.acquireStoreLock()) {
        return false;
      }

      try {
        this.metaBuffers.delete(key);
        this.dataBuffers.delete(key);
        this.ttlMap.delete(key);
        this.channel.postMessage({
          action: 'delete',
          key
        });
        return true;
      } finally {
        this.releaseStoreLock();
      }
    } finally {
      this.releaseLock(metaBuffer);
    }
  }

  deletePattern(pattern) {
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

    if (!this.acquireStoreLock()) {
      return false;
    }

    try {
      let deleted = false;
      for (const [key, metaBuffer] of this.metaBuffers.entries()) {
        if (regex.test(key)) {
          if (this.acquireLock(metaBuffer)) {
            try {
              this.metaBuffers.delete(key);
              this.dataBuffers.delete(key);
              deleted = true;
            } finally {
              this.releaseLock(metaBuffer);
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
    listKeys: store.listKeys.bind(store),
    close: () => {
      store.close();
      Object.keys(wrapper).forEach(key => delete wrapper[key]);
    }
  };
  stores.set(storeName, wrapper);
  return wrapper;
}

module.exports = { createStore };