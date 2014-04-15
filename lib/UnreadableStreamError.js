'use strict';

var util = require('util');

// # UnreadableStreamError

// Instances of this class are used as rejection reasons when an underlying
// stream has become unreadable, but is supposed to be consumed further.
function UnreadableStreamError() {}

// Extends `Error`.
util.inherits(UnreadableStreamError, Error);

// Each instance will have a `name` property with a value of
// `"unreadable-stream"`. However, the instances will not have stack traces.
UnreadableStreamError.prototype.name = 'unreadable-stream';
UnreadableStreamError.prototype.stack = null;
// Node should log the error as `[UnreadableStreamError]`.
UnreadableStreamError.prototype.inspect = function() {
  return '[UnreadableStreamError]';
};

module.exports = UnreadableStreamError;
