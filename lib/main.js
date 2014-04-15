'use strict';

// # main

// # Streamist

// Enables functional interactions with Readable streams. [Read
// more](./streamist.js.html).
exports.Streamist = require('./Streamist');

// ## UnreadableStreamError

// Instances of this class are used as rejection reasons when an underlying
// stream has become unreadable, but is supposed to be consumed further. [Read
// more](./UnreadableStreamError.js.html).
exports.UnreadableStreamError = require('./UnreadableStreamError');

// ## EndOfStreamError

// Instances of this class are used as rejection reasons when a stream ends
// while being consumed. [Read more](./EndOfStreamError.js.html).
exports.EndOfStreamError = require('./EndOfStreamError');
