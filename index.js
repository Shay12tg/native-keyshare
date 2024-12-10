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
            structuredClone: true
          });
          if (!isNativeAccelerationEnabled) {
            console.error('Native acceleration not enabled, verify that install finished properly');
          }
        }
      } catch (E) {
        console.warn(E);
      }
      this.packr ||= {
        pack: value => {
          const jsonStr = JSON.stringify(value);
          const encoder = new TextEncoder();
          return encoder.encode(jsonStr);
        },
        unpack: buffer => {
          const decoder = new TextDecoder();
          const jsonStr = decoder.decode(buffer);
          return JSON.parse(jsonStr);
        }
      }
  
      this.buffers = new Map(); // key -> SharedArrayBuffer
      this.workers = new Set();
  
      console.log('SharedKVStore initialized');
      return this;
    }
  
    registerFork(worker) {
      if (!worker) return false;
  
      this.workers.add(worker);
  
      console.log(`Registering worker: ${worker.threadId}`);
      worker.postMessage({
        type: 'SKV:INIT_RESPONSE',
        buffers: Array.from(this.buffers.entries()).map(([key, buffer]) => ({ key, buffer })),
      });
  
      worker.on('error', (err) => {
        console.error(`Worker error: ${err.message}`);
        this.workers.delete(worker);
      });
  
      worker.on('exit', (code) => {
        console.warn(`Worker exited with code: ${code}`);
        this.workers.delete(worker);
      });
  
      return true;
    }
  
    unregisterFork(worker) {
      this.workers.delete(worker);
      console.log(`Unregistered worker: ${worker.threadId}`);
      return true;
    }
  
    set(key, value, resizeBuffer = false) {
      console.log(`Primary: Setting key=${key}, value=${JSON.stringify(value)}, resizeBuffer=${resizeBuffer}`);
  
      if (value === undefined) {
        console.warn(`Attempted to set undefined value for key: ${key}`);
        return false;
      }
  
      const data = this.packr.pack(value); // Use msgpackr to serialize the value
      let buffer = this.buffers.get(key);
  
      if (buffer && !resizeBuffer && buffer.byteLength >= data.length + 4) {
        console.log(`Reusing buffer for key: ${key}`);
        const view = new DataView(buffer);
        view.setUint32(0, data.length);
        new Uint8Array(buffer, 4, data.length).set(data);
      } else {
        console.log(`Allocating new buffer for key: ${key}`);
        buffer = new SharedArrayBuffer(data.length + 4);
        const view = new DataView(buffer);
        view.setUint32(0, data.length);
        new Uint8Array(buffer, 4).set(data);
  
        this.buffers.set(key, buffer);
  
        for (const worker of this.workers) {
          try {
            console.log(`Notifying worker ${worker.threadId} about new key: ${key}`);
            worker.postMessage({
              type: 'SKV:UPDATE',
              action: 'set',
              key,
              buffer,
            });
          } catch (err) {
            console.error(`Failed to notify worker about key: ${key}. Error: ${err.message}`);
          }
        }
      }
  
      return true;
    }
  
    get(key) {
      // console.log(`Primary: Getting key=${key}`);
      const buffer = this.buffers.get(key);
  
      if (!buffer) {
        console.warn(`Attempted to get undefined key: ${key}`);
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
      console.log(`Primary: Deleting key=${key}`);
      if (!this.buffers.has(key)) {
        console.warn(`Attempted to delete undefined key: ${key}`);
        return false;
      }
  
      this.buffers.delete(key);
  
      for (const worker of this.workers) {
        try {
          console.log(`Notifying worker ${worker.threadId} about deletion of key: ${key}`);
          worker.postMessage({
            type: 'SKV:UPDATE',
            action: 'delete',
            key,
          });
        } catch (err) {
          console.error(`Failed to notify worker about deletion of key: ${key}. Error: ${err.message}`);
        }
      }
  
      return true;
    }
  }
  
  function createStore(parentPort) {
    const store = new SharedKVStore();
  
    const messageHandler = (message) => {
      console.log(`Worker: Received message: ${JSON.stringify(message)}`);
      if (!message || typeof message !== 'object') return;
  
      try {
        switch (message.type) {
          case 'SKV:INIT_RESPONSE':
            console.log('Worker: Initializing buffers');
            if (Array.isArray(message.buffers)) {
              message.buffers.forEach(({ key, buffer }) => {
                if (buffer instanceof SharedArrayBuffer) {
                  store.buffers.set(key, buffer);
                  console.log(`Worker: Buffer initialized for key: ${key}`);
                }
              });
            }
            break;
  
          case 'SKV:UPDATE':
            if (message.action === 'set' && message.buffer instanceof SharedArrayBuffer) {
              store.buffers.set(message.key, message.buffer);
              console.log(`Worker: Buffer updated for key: ${message.key}`);
            } else if (message.action === 'delete') {
              store.buffers.delete(message.key);
              console.log(`Worker: Buffer deleted for key: ${message.key}`);
            }
            break;
  
          default:
            console.warn(`Worker: Unknown message type received: ${message.type}`);
            break;
        }
      } catch (err) {
        console.error(`Worker: Error handling message: ${err.message}`);
      }
    };
  
    parentPort.on('message', messageHandler);
  
    console.log('Worker: Requesting initialization data');
    parentPort.postMessage({ type: 'SKV:INIT_REQUEST' });
  
    return {
      set: store.set.bind(store),
      get: store.get.bind(store),
      delete: store.delete.bind(store),
    };
  }
  
  function createManager() {
    const store = new SharedKVStore();
  
    return {
      registerFork: store.registerFork.bind(store),
      unregisterFork: store.unregisterFork.bind(store),
    };
  }
  
  module.exports = { createManager, createStore };