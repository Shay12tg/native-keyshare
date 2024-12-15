const { Worker, isMainThread } = require('worker_threads');
const { createStore } = require('./index');

const store = createStore('');

if (isMainThread) {
  console.log('Primary process started');


  store.set('test', { hello: 1 }, {minBufferSize: 10000});
  store.set('test', { hello: '133' });
  store.set('test', { hello: '12333' });
  store.set('test', { hello: 1, kk:'1111111111111111111111111111111111111111111111111' });
  
  let m = process.hrtime();
  let x = 1;
  for (let i = 0; i < 10000; i++) {
    const y = store.get('test');
    if (y.hello++ !== x++) {
      console.error('a', y.hello, x);
      process.exit(0)
    }
    y.kk += '1';
    store.set('test', y);
    
  }
  // console.log(store.get('test'))
  console.log(getDurationInMilliseconds(m));
  // process.exit();

  const worker1 = new Worker(__filename);
  const worker2 = new Worker(__filename);

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