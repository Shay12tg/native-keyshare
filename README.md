# native-keyshare

A high-performance shared key-value store implementation designed for multi-threaded environments. This library leverages `SharedArrayBuffer` to enable efficient data sharing between worker threads.

## Features

- **Shared Data Access**: Allows multiple worker threads to share and manipulate a single key-value store.
- **High Performance**: Optimized for fast reads and writes using binary data formats.
- **Worker Management**: Seamlessly register and unregister worker threads.
- **TypeScript Support**: Includes type definitions for a great developer experience.

## Prerequisites

- **Node.js** >= 15.0.0
- **msgpackr** (optional): Improves serialization/deserialization performance by 2x.
- **msgpackr-extract** (optional): Additional 10-20% performance gain.

## Installation

Install the library using npm:

    npm install shared-kv-store

If you want to enable optional performance improvements, also install `msgpackr`:

    npm install msgpackr

## Usage

### Creating a Shared Key-Value Manager

The manager runs in the main thread and coordinates access to the key-value store across worker threads.

#### Main Thread Example

    const { createManager } = require('shared-kv-store');
    const { Worker } = require('worker_threads');

    const manager = createManager();

    const worker1 = new Worker('./worker.js');
    const worker2 = new Worker('./worker.js');

    manager.registerFork(worker1);
    manager.registerFork(worker2);

    const store = globalThis.SharedKVStore.instance;

    store.set('exampleKey', { value: 'Hello from Main!' });
    console.log(store.get('exampleKey')); // Outputs: { value: 'Hello from Main!' }

#### Worker Thread Example (`worker.js`)

    const { createStore } = require('shared-kv-store');

    const store = createStore(parentPort);

    setTimeout(() => {
      console.log(store.get('exampleKey')); // Outputs: { value: 'Hello from Main!' }
      store.set('workerKey', { data: 'Hello from Worker!' });
    }, 1000);

## API

### Manager API

#### `createManager()`
Creates a new shared key-value manager.

**Returns**: `ISharedKVManager`

- **`registerFork(worker: Worker): boolean`**  
  Registers a worker thread to the manager.

- **`unregisterFork(worker: Worker): boolean`**  
  Unregisters a worker thread from the manager.

### Store API

#### `createStore(parentPort: MessagePort)`
Creates a new shared key-value store for a worker thread.

**Returns**: `ISharedKVStore`

- **`set(key: string, value: any, resizeBuffer?: boolean): boolean`**  
  Sets a key-value pair in the store.

- **`get(key: string): any`**  
  Retrieves the value associated with a key.

- **`delete(key: string): boolean`**  
  Deletes a key-value pair from the store.

## Example

### Full Example

#### Main Thread

    const { createManager } = require('shared-kv-store');
    const { Worker } = require('worker_threads');

    const manager = createManager();
    const worker = new Worker('./worker.js');
    manager.registerFork(worker);

    const kvStore = globalThis.SharedKVStore.instance;
    kvStore.set('exampleKey', { value: 'Hello from Main!' });
    console.log(kvStore.get('exampleKey')); // { value: 'Hello from Main!' }

#### Worker (`worker.js`)

    const { createStore } = require('shared-kv-store');

    const store = createStore(parentPort);

    setTimeout(() => {
      console.log(store.get('exampleKey')); // { value: 'Hello from Main!' }
      store.set('workerKey', { data: 'Hello from Worker!' });
    }, 1000);

## Benchmarks

Performance test for `get`:

    const store = globalThis.SharedKVStore.instance;
    store.set('test', { value: 'Benchmark' });

    console.time('Benchmark');
    for (let i = 0; i < 10000000; i++) {
      store.get('test');
    }
    console.timeEnd('Benchmark');
