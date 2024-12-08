try {
    module.exports = require('./build/Release/shared_object');
} catch (err) {
    module.exports = require('./build/Debug/shared_object');
} 