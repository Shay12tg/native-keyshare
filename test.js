const { Worker, isMainThread, parentPort } = require('worker_threads');
const { createManager, createStore } = require('./index');

const store = createStore();

if (isMainThread) {
  console.log('Primary process started');

  // Create two worker threads instead of forks
  const worker1 = new Worker(__filename);
  const worker2 = new Worker(__filename);

  store.set('someval', { hello: '1' });

  let m = process.hrtime();
  for (let i = 0; i < 10000; i++) {
    store.get('someval');
  }
  console.log(getDurationInMilliseconds(m));

  setTimeout(() => {
    const worker3 = new Worker(__filename);
  }, 200);

  let i = 8;
  // Wait a bit longer before starting test sequence to ensure workers are ready
  setTimeout(() => {
    console.log('Primary: Setting initial value');
    store.set('test', { hello: 'world' + i++ });
  }, 100);
  setTimeout(() => {
    console.log('Primary: Setting initial value');
    store.set('test', { hello: 'world' + i++ });
  }, 200);
  setTimeout(() => {
    console.log('Primary: Setting initial value');
    store.set('test', { hello: 'world' + i++ });
  }, 300);

  setTimeout(() => {
    console.log('Primary: Setting updated value');
    store.set('test', { hello: 'updated world' + i++ });
  }, 1000);

  setTimeout(() => {
    console.log('Primary: Deleting value');
    store.delete('test');
  }, 1500);


  // Handle worker exits
  process.on('exit', () => {
    console.log('Primary exited');
  });

} else {
  console.log(`Worker started`);

  console.log(`Worker initialized`);

  // Start querying after initialization
  const checkInterval = setInterval(() => {
    const value = store.get('test');
    console.log(`Worker: current value:`, value);
  }, 200);

  // Exit after a while
  setTimeout(() => {
    clearInterval(checkInterval);
    process.exit(0);
  }, 2000);
}


function getDurationInMilliseconds(start) {
  const NS_PER_SEC = 1e9;
  const NS_TO_MS = 1e6;
  const diff = process.hrtime(start);

  return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
};