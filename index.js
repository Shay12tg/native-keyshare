const { BroadcastChannel } = require('node:worker_threads');

class SharedKVStore {
  constructor(msgpack = true) {
    if (globalThis.SharedKVStore) {
      return globalThis.SharedKVStore;
    }
    globalThis.SharedKVStore = this;

    try {
      if (msgpack) {
        const { Packr, isNativeAccelerationEnabled } = require('msgpackr');
        this.packr = new Packr({
          bundleStrings: false,
          mapsAsObjects: true,
          useRecords: false,
          structuredClone: true,
        });
        if (!isNativeAccelerationEnabled) {
          console.error('Native acceleration not enabled, verify that install finished properly');
        }
      }
    } catch (E) {
      console.warn(E);
    }
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

    this.buffers = new Map(); // key -> SharedArrayBuffer
    this.channel = new BroadcastChannel('SharedKVStore');
    this.channel.onmessage = (message) => {
      this.handleMessage(message.data);
    };

    return this;
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;

    try {
      const { action, key, buffer } = message;

      if (action === 'set' && buffer instanceof SharedArrayBuffer) {
        this.buffers.set(key, buffer);
      } else if (action === 'delete') {
        this.buffers.delete(key);
      }
    } catch (err) {
      console.error(`Error handling message: ${err.message}`);
    }
  }

  set(key, value, resizeBuffer = false) {
    if (value === undefined) {
      console.warn(`Attempted to set undefined value for key: ${key}`);
      return false;
    }

    const data = this.packr.pack(value); // Use msgpackr to serialize the value
    let buffer = this.buffers.get(key);

    if (buffer && !resizeBuffer && buffer.byteLength >= data.length + 4) {
      const view = new DataView(buffer);
      view.setUint32(0, data.length);
      new Uint8Array(buffer, 4, data.length).set(data);
    } else {
      buffer = new SharedArrayBuffer(data.length + 4);
      const view = new DataView(buffer);
      view.setUint32(0, data.length);
      new Uint8Array(buffer, 4).set(data);

      this.buffers.set(key, buffer);
    }

    this.channel.postMessage({
      action: 'set',
      key,
      buffer,
    });

    return true;
  }

  get(key) {
    const buffer = this.buffers.get(key);

    if (!buffer) {
      return undefined;
    }

    try {
      const view = new DataView(buffer);
      const size = view.getUint32(0);

      if (size === 0) {
        return null;
      }

      const data = new Uint8Array(buffer, 4, size);
      return this.packr.unpack(data); // Use msgpackr to deserialize the value
    } catch (err) {
      console.error(`Failed to parse buffer for key: ${key}. Error: ${err.message}`);
      return undefined;
    }
  }

  delete(key) {
    if (!this.buffers.has(key)) {
      return false;
    }

    this.buffers.delete(key);

    this.channel.postMessage({
      action: 'delete',
      key,
    });

    return true;
  }
}

function createStore() {
  const store = new SharedKVStore();

  return {
    set: store.set.bind(store),
    get: store.get.bind(store),
    delete: store.delete.bind(store),
  };
}

module.exports = { createStore };