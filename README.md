# native-keyshare

A high-performance shared key-value store implementation designed for multi-threaded environments. This library leverages `SharedArrayBuffer` to enable efficient data sharing between worker threads.

## Features

- **Shared Data Access**: Allows multiple worker threads to share and manipulate data using named stores
- **High Performance**: Optimized for fast reads and writes using TypedArrays and efficient buffer handling
- **Pattern Operations**: Built-in support for wildcards and regex patterns
- **Simplified Communication**: Uses BroadcastChannel for seamless thread communication
- **No Dependencies**: Core functionality works without external dependencies
- **Optional msgpackr**: 2-4x performance boost when using msgpackr

## Prerequisites

- **Node.js** >= 16.0.0
- **msgpackr** (optional): Improves serialization/deserialization performance by 2-4x

## Installation

Install the library using npm:

```bash
npm install native-keyshare
```

If you want to enable performance improvements, also install `msgpackr`:

```bash
npm install msgpackr
```

## Usage

### Basic Operations

```javascript
const { createStore } = require('native-keyshare');

// Create a named store
const store = createStore('mystore');

// Basic operations
store.set('user:1', { name: 'John' });
console.log(store.get('user:1'));  // { name: 'John' }
store.delete('user:1');

// Named stores are isolated
const cacheStore = createStore('cache');
const userStore = createStore('users');

// Get same store instance
const sameStore = createStore('mystore');
```

### Worker Thread Example

#### Main Thread (`index.js`)
```javascript
const { Worker } = require('worker_threads');
const { createStore } = require('native-keyshare');

const store = createStore('shared');
store.set('sharedKey', { value: 'Hello from main!' });

const worker1 = new Worker('./worker.js');
const worker2 = new Worker('./worker.js');
```

#### Worker Thread (`worker.js`)
```javascript
const { createStore } = require('native-keyshare');

const store = createStore('shared');
console.log(store.get('sharedKey'));  // { value: 'Hello from main!' }
store.set('workerKey', { data: 'Hello from worker!' });
```

#### Locks
```javascript
// Initialize counter - minBufferSize to reuse the same buffer even when increasing length
store.set('counter', 0, { minBufferSize: 20 });
// the following code could be executed from every thread
if (store.lock('counter')) {
  try {
    const x = store.get('counter', true);
    store.set('counter', x + 1, { skipLock: true });
  } finally {
    store.release('counter');
  }
}
```

## API

### Store Creation

#### `createStore(storeName?: string)`
Creates or retrieves a named key-value store instance.

```javascript
const store = createStore('mystore');    // Named store
const defaultStore = createStore();      // Default store
```

### Store Methods

#### `set(key: string, value: any, options?: Options): boolean`
Sets a key-value pair in the store.
- **options.minBufferSize**: Initial buffer size in bytes if you expect value to grow
- **options.immutable**: Dont allow rewriting the buffer. create a new one on update.
- **options.ttl**: TTL in seconds.

#### `get(key: string, skipLock: boolean = false): any`
Retrieves a value from the store.

#### `delete(key: string): boolean`
Deletes a value. Supports patterns.

#### `listKeys(pattern?: string): string[]`
Lists all keys, optionally filtered by pattern.

#### `lock(key: string, timeout = 1000): boolean`
Locks a key.

#### `release(key: string): boolean`
Releases a locked key.

#### `clear(): void`
Clear the store.

#### `close(): void`
Close the store. cleanup local maps and buffer references.

### Pattern Operations

The store supports two pattern matching styles for delete() and listKeys():

```javascript
// Glob-style wildcards
store.delete('users:*');     // Matches: users:123, users:abc, etc
store.delete('session:?');   // Matches: session:1, session:a
store.delete('cache:??');    // Matches: cache:12, cache:ab

// Regular expressions (enclosed in forward slashes)
store.delete('/^user_\d+$/');   // Matches: user_1, user_123
store.delete('/test_.+/');      // Matches: test_abc, test_123

// List keys matching patterns
const userKeys = store.listKeys('user:*');
const logKeys = store.listKeys('/log_\d+/');
```

## Performance Tips

1. Use msgpackr for better serialization (2-4x faster)
2. Set appropriate minBufferSize when you know data will grow
3. Batch operations when possible instead of individual calls
4. Use pattern operations sparingly on large stores

## Benchmarks

Performance test for `get`:

```javascript
const store = createStore();
store.set('test', { value: 'Benchmark' });

console.time('Benchmark');
for (let i = 0; i < 10000000; i++) {
  store.get('test');
}
console.timeEnd('Benchmark');
```
