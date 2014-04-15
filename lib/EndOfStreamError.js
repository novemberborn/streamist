'use strict';

var util = require('util');

// # EndOfStreamError

// Instances of this class are used as rejection reasons when a stream ends
// while being consumed.
function EndOfStreamError() {}

// Extends `Error`.
util.inherits(EndOfStreamError, Error);

// Each instance will have a `name` property with a value of `"end-of-stream"`.
// However, the instances will not have stack traces.
EndOfStreamError.prototype.name = 'end-of-stream';
EndOfStreamError.prototype.stack = null;
// Node should log the error as `[EndOfStreamError]`.
EndOfStreamError.prototype.inspect = function() {
  return '[EndOfStreamError]';
};

module.exports = EndOfStreamError;
