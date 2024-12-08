const { Worker, isMainThread } = require('worker_threads');
const addon = require('./index');

if (isMainThread) {
    const originalObj = { 
        hello: 'world',
        number: 42,
        nested: { foo: 'bar' }
    };
    
    console.log('Main thread setting object:', originalObj);
    addon.set('test', originalObj);
    
    const worker = new Worker(__filename);
    
    setInterval(() => {
        const obj = addon.get('test');
        obj.x = (obj.x ?? 0) + 1;
        addon.set('test', obj);
        console.log('Main thread reads:', obj);
    }, 1000);
    
} else {
    setInterval(() => {
        const obj = addon.get('test');
        obj.y = (obj.y ?? 0) + 1;
        addon.set('test', obj);
        console.log('Worker thread reads:', obj);
    }, 1000);
}