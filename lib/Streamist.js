'use strict';

var Readable = require('stream').Readable;

var Promise = require('legendary').Promise;
var Series = require('legendary').Series;
var Thenstream = require('thenstream').Thenstream;

var EndOfStreamError = require('./EndOfStreamError');
var UnreadableStreamError = require('./UnreadableStreamError');

var util = require('./private/util');

function ConsumptionState() {
  this.waiting = null;
  this.readable = true;
  this.reachedEnd = false;
}

// # Streamist(streamOrThenable)

// Enables functional interactions with Readable streams, inspired by
// Legendary's
// [`Series`](http://novemberborn.github.io/legendary/lib/series.js.html) class.

// `streamOrThenable` is expected to be a Readable stream, or a thenable for
// one. [Thenstream](https://github.com/novemberborn/thenstream) is used if
// `streamOrThenable` is not a stream.
function Streamist(streamOrThenable) {
  if (!(this instanceof Streamist)) {
    return new Streamist(streamOrThenable);
  }

  var state = this._consumptionState = new ConsumptionState();

  var stream = streamOrThenable;
  if (!util.isStreamLike(streamOrThenable)) {
    stream = new Thenstream(streamOrThenable);
  }

  // ## Streamist#stream

  // Provides a reference to the underlying stream. Use this to set encoding,
  // listen for `close` events, `unshift()`, `pipe()`, or otherwise interact
  // with the stream.
  this.stream = stream;

  // ## Streamist#complete

  // `Promise` instance that is fulfilled with `true` when the underlying stream
  // has been completely consumed. If no stream could be determined the promise
  // is rejected with a `TypeError` instance. If the stream emits the `error`
  // event, the promise is rejected with the first argument as the rejection
  // reason.

  // If the promise is cancelled, any active consumption operations are also
  // cancelled, and no new consumptions can be started.

  // Cancellation does not propagate to any `streamOrThenable` promise.
  this.complete = new Promise(function(resolve, reject) {
    function onEnd() {
      cleanup();
      state.readable = false;
      state.reachedEnd = true;
      resolve(true);
    }
    function onError(error) {
      cleanup();
      state.readable = false;
      reject(error);
    }
    function cleanup() {
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    }

    stream.once('end', onEnd);
    stream.once('error', onError);

    return function() {
      cleanup();

      state.readable = false;

      if (state.waiting) {
        state.waiting.cancel();
      }
    };
  });

  // ## Streamist#cancel()

  // Cancels any active consumption operations and prevents new ones from being
  // started. Alias for `Streamist#complete.cancel()`.
  this.cancel = this.complete.cancel;
}
module.exports = Streamist;

// ## Generic consuming instance methods

// ### Streamist#consumeObject(size)

// Returns a `Promise` instance that is fulfilled with the next `size` bytes
// consumed from the underlying stream, wrapped in an object containing a single
// `value` property. The promise remains pending until data becomes available.
// It is rejected if the stream emits an `error`, with the first argument as the
// rejection reason.

// Cancellation through `Streamist#cancel()` or `Streamist#complete.cancel()`
// will propagate to the returned promise.
Streamist.prototype.consumeObject = function(size) {
  var state = this._consumptionState;
  if (!state.readable) {
    // If the stream is no longer readable, the promise will be rejected with an
    // `UnreadableStreamError` instance.
    return Promise.rejected(new UnreadableStreamError());
  }

  var self = this;
  var stream = this.stream;
  var waiting = state.waiting;
  var stillWaiting = true;

  if (!waiting) {
    var chunk = stream.read(size);
    if (chunk !== null) {
      return Promise.from({ value: chunk });
    }

    waiting = new Promise(function(resolve, reject) {
      function onReadable() {
        cleanup();
        resolve();
      }
      function onEnd() {
        cleanup();
        // If the underlying stream ends, the promise will be rejected with an
        // `EndOfStreamError` instance.
        reject(new EndOfStreamError());
      }
      function onError(reason) {
        cleanup();
        reject(reason);
      }
      function cleanup() {
        stillWaiting = false;
        state.waiting = null;
        stream.removeListener('end', onEnd);
        stream.removeListener('error', onError);
        stream.removeListener('readable', onReadable);
      }

      stream.on('end', onEnd);
      stream.on('error', onError);

      //Node v0.10: If the stream is ending (`end` has not yet been emitted),
      //listening for `readable` will cause the listener to be invoked
      //synchronously. This is fixed in v0.11, see
      //<https://github.com/joyent/node/pull/5865>. Therefore only listen at the
      //very end, so we can clean up the other listeners.
      stream.on('readable', onReadable);

      return cleanup;
    });

    //Only assign the promise if it hasn't resolved synchronously (see above).
    if (stillWaiting) {
      state.waiting = waiting;
    }
  }

  return waiting.fork().then(function() {
    if (state.reachedEnd) {
      //The end could be reached as data has become available. Test for that
      //here since the next call to `consumeObject` will reject with an
      //`UnreadableStreamError`.
      throw new EndOfStreamError();
    }
    return self.consumeObject(size);
  });
};

// ### Streamist#consume(size)

// Builds on top of `Streamist#consumeObject(size)`, but returns a promise
// for the value of the consumed object.

// If the underlying stream is in object mode, and the object happens to be a
// promise or thenable, the returned promise will assimilate the object's state,
// remaining pending until it has done so. If the promise or thenable is
// rejected, so will the returned promise. It may be hard to differentiate
// rejection reasons coming from the stream or from an object.

// Each invocation still consumes the underlying stream, regardless of the
// state of a promise returned by a preceeding invocation.
Streamist.prototype.consume = function(size) {
  return this.consumeObject(size).then(util.extractValue);
};

// ### Streamist#toArray([constructor])

// Completely consumes the underlying stream, resulting in an array containing
// each chunk. Returns a promise for that array. Specify `constructor` to
// control the promise subclass that's returned. Defaults to Legendary's
// [`Series`](http://novemberborn.github.io/legendary/lib/series.js.html).

// If the stream contains promise or thenable objects they'll be included in
// the array as-is.
Streamist.prototype.toArray = function(constructor) {
  var arr = [];
  return this.each(function(chunk) {
    arr.push(chunk);
  }).yield(arr).to(constructor || Series);
};

// ### Streamist#toBuffer([length])

// Completely consumes the underlying stream, returning a `Promise` instance for
// a concatenated buffer of all chunks. Pass `length` if you know the total
// length of the buffer ahead of time.

// Will behave unexpectedly if the stream does not contain buffers.
Streamist.prototype.toBuffer = function(length) {
  var arr = [];
  return this.each(function(chunk) {
    arr.push(chunk);
  }).then(function() {
    return Buffer.concat(arr, length);
  });
};

// ## Non-streaming iterators

// Like Legendary's `Series` you can consume the underlying stream using
// iterator callbacks. They'll be called with each chunk. No other arguments are
// passed. If the underlying stream contains promises or thenables, they'll be
// passed to the iterator callbacks as-is, without being assimilated. The
// callbacks may return a value or a `Promise` instance. Unless noted otherwise,
// `thenables` are *not* assimilated.

// Parallelization controls the number of pending promises (as returned by
// an iterator callback) an operation is waiting on. Per operation no new
// callbacks are invoked when this number reaches the maximum concurrency, as
// specified in the `maxConcurrent` argument.

// ### Streamist#each(iterator)

// Iterates over each chunk in the underlying stream. Returns a `Promise`
// instance that is fulfilled with `undefined` when the iterating has completed.

// The promise is rejected with an `UnreadableStreamError` instance if the
// stream cannot be consumed when the iteration is started.

// Cancellation of the promise propagates to pending promises returned by
// `iterator`.
Streamist.prototype.each = function(iterator) {
  return this.eachParallel(1, iterator);
};

// ### Streamist#eachParallel(maxConcurrent, iterator)

// See `Streamist#each(iterator)`.
Streamist.prototype.eachParallel = function(maxConcurrent, iterator) {
  if (typeof maxConcurrent !== 'number') {
    return Promise.rejected(new TypeError('Missing max concurrency number.'));
  }
  if (typeof iterator !== 'function') {
    return Promise.rejected(new TypeError('Missing iterator function.'));
  }

  var state = this._consumptionState;
  if (!state.readable) {
    return Promise.rejected(new UnreadableStreamError());
  }

  var self = this;
  return new Promise(function(resolve, reject) {
    var pendingPromises = [];

    var stopIteration = false;
    var running = 0;
    function oneCompleted() {
      running--;
      runConcurrent();
    }
    function oneFailed(reason) {
      if (!stopIteration) {
        stopIteration = true;
        running = -1;
        reject(reason);
      }
    }
    function checkEnd(reason) {
      if (reason instanceof EndOfStreamError) {
        stopIteration = true;
      } else {
        throw reason;
      }
    }
    function callIterator(wrapped) {
      var result = iterator(wrapped.value);
      //Only return `result` if it is a promise, to avoid accidentally
      //assimilating a thenable.
      return Promise.isInstance(result) && result;
    }
    function runConcurrent() {
      if (stopIteration || state.reachedEnd) {
        if (running === 0) {
          resolve();
        }
        return;
      }

      if (running >= maxConcurrent) {
        return;
      }

      running++;

      var pending = self.consumeObject()
        .then(callIterator, checkEnd)
        .then(oneCompleted, oneFailed)
        .then(function() {
          pendingPromises.splice(pendingPromises.indexOf(pending), 1);
        });
      pendingPromises.push(pending);

      if (!state.waiting) {
        runConcurrent();
      }
    }

    process.nextTick(runConcurrent);

    return function() {
      stopIteration = true;
      running = -1;
      pendingPromises.slice().forEach(util.invokeCancel);
    };
  });
};

// ### Streamist#detect(iterator)

// Iterates over the underlying stream, returning a `Promise` instance that will
// be fulfilled with the chunk for which `iterator` first returned a truey
// (promise fulfillment) value. If no match is found, the promise will be
// fulfilled with `undefined`.

// If the chunk is a promise or thenable, only the detected chunk will be
// assimilated.

// Iteration is stopped when the promise is fulfilled. Relies on
// `Streamist#eachParallel()` for consuming the chunks.
Streamist.prototype.detect = function(iterator) {
  return this.detectParallel(1, iterator);
};

// ### Streamist#detectParallel(maxConcurrent, iterator)

// See `Streamist#detect(iterator)`. Each promise returned by the iterator is
// racing the other promises to fulfill with a truey value first. The returned
// promise will be fulfilled with the chunk for which that promise was returned
// from `iterator`.
Streamist.prototype.detectParallel = function(maxConcurrent, iterator) {
  return this.eachParallel(maxConcurrent, util.shortcutDetect(iterator))
    .then(util.makeUndefined, util.extractShortcutValue);
};

// ### Streamist#some(iterator)

// Iterates over the underlying stream, returning a `Promise` instance that will
// be fulfilled with `true` if an iterator returns a truey (promise fulfillment)
// value, or `false` if no iterator does so.

// Iteration is stopped when the promise is fulfilled. Relies on
// `Streamist#eachParallel()` for consuming the chunks.
Streamist.prototype.some = function(iterator) {
  return this.someParallel(1, iterator);
};

// ### Streamist#someParallel(maxConcurrent, iterator)

// See `Streamist#some(iterator)`.
Streamist.prototype.someParallel = function(maxConcurrent, iterator) {
  return this.eachParallel(maxConcurrent, util.shortcutSome(iterator))
    .then(util.makeFalse, util.extractShortcutValue);
};

// ### Streamist#every(iterator)

// Iterates over the underlying stream, returning a `Promise` instance that will
// be fulfilled with `true` if all iterations return a truey (promise
// fulfillment) value, or `false` when an iteration does not.

// Iteration is stopped when the promise is fulfilled. Relies on
// `Streamist#eachParallel()` for consuming the chunks.
Streamist.prototype.every = function(iterator) {
  return this.everyParallel(1, iterator);
};

// ### Streamist#everyParallel(maxConcurrent, iterator)

// See `Streamist#every(iterator)`.
Streamist.prototype.everyParallel = function(maxConcurrent, iterator) {
  return this.eachParallel(maxConcurrent, util.shortcutNotEvery(iterator))
    .then(util.makeTrue, util.extractShortcutValue);
};

// ### Streamist#foldl(initialValue, iterator)

// Folds each chunk from the underlying stream into another value. At each
// stage, `iterator` is called with the result of the folding operation at that
// point, and the next chunk from the stream. Returns a `Promise` instance for
// the result of the folding operation.

// Unlike `Array#reduce()` the initial value must be passed as the first
// argument. `initialValue` may be a promise or even a thenable: `iterator`
// won't be called until `initialValue` has fulfilled. If it rejects, the
// returned promise is rejected with the same reason.

// Thenables returned by `iterator` are assimilated.

// This method has no parallel equivalent. Use `Streamist#mapParallel()` to
// collect values concurrently, and then use this method with a synchronous
// iterator.

// Relies on `Streamist#eachParallel()` for consuming the chunks. Note that if
// the underlying stream contains promises or thenables, they'll be passed to
// `iterator` as-is, without being assimilated.
Streamist.prototype.foldl = function(initialValue, iterator) {
  var self = this;
  return Promise.from(initialValue).then(function(result) {
    return self.eachParallel(1, function(chunk) {
      return Promise.from(iterator(result, chunk)).then(function(value) {
        result = value;
      });
    }).then(function() {
      return result;
    });
  });
};

// ## Streaming iterators

// The `map`, `filter` and `filterOut` methods return a new `Streamist`
// instance that streams the results of the operation. This impacts
// parallelization, since the results must be streamed in their original order.

// Parallelization is affected not only by the number of pending promises an
// operation is waiting on, but also by whether the results of previous
// callbacks have been pushed to the result stream. For instance, if the maximum
// concurrency is 3, and the first callback is returns a promise that remains
// pending longer than the second and third callbacks, the fourth callback won't
// be invoked until the promise returned by the first callback has fulfilled and
// been pushed to the result stream. Backpressure on the result stream thus also
// reduces the number of parallel callback invocations.

// Errors from the consumption of the original stream are emitted on the
// returned instance. If consumption of the returned instance is cancelled, so
// is consumption of the original stream.

Streamist.prototype._streamResults = function(
  maxConcurrent, iterator, testResult, streamOptions) {

  var resultStream = new Readable(
    streamOptions || util.getStreamOptions(this.stream)
  );
  var resultStreamist = new this.constructor(resultStream);

  var pressurePromise = null, relieveBackpressure = null;
  function applyBackpressure() {
    return pressurePromise || (pressurePromise = new Promise(function(resolve) {
      relieveBackpressure = function() {
        pressurePromise = relieveBackpressure = null;
        resolve(true);
      };
    }));
  }

  function pushResult(result, chunk) {
    var pushable = testResult(result);
    if (pushable === util.STREAM_CHUNK_INSTEAD) {
      result = chunk;
    }

    if (!pushable) {
      return true;
    }
    return resultStream.push(result) !== false || applyBackpressure();
  }

  var self = this;
  var consuming = null;
  resultStream._read = function() {
    //The original stream is only consumed once, though the result stream may
    //apply backpressure. When it's ready for more data, all we need to do is
    //relieve that pressure.
    if (consuming) {
      if (relieveBackpressure) {
        relieveBackpressure();
      }
      return;
    }

    //Starting point for the promise-chain that ensures each result is pushed in
    //the order the original chunk was read, irrespective of which iteration
    //completes first, or whether backpressure is applied.
    var pushNext = Promise.from(true);

    //Consume the stream. We only start the iteration once and rely on
    //`pushResult()` to manage backpressure.
    consuming = self.eachParallel(maxConcurrent, function(chunk) {
      var result = iterator(chunk);

      //Only assimilate promises, for consistency with Legendary's Series
      //interface.
      if (Promise.isInstance(result)) {
        pushNext = pushNext.yield(result).then(function(result) {
          return pushResult(result, chunk);
        });
      } else {
        pushNext = pushNext.then(function() {
          return pushResult(result, chunk);
        });
      }

      return pushNext;
    }).then(function() {
      //Once all results have been pushed, end the stream.
      resultStream.push(null);
    }).otherwise(function(reason) {
      //Any error from the iteration or the underlying stream will reach here.
      resultStream.emit('error', reason);
    });

    //Ensure consumption stops if the returned stream is cancelled.
    resultStreamist.complete.alsoCancels(consuming);
  };

  return resultStreamist;
};

// ### Streamist#map(iterator, [options])

// Maps each chunk in the underlying stream using `iterator`.

// Specify `options` to configure the stream that underlies the returned
// `Streamist` instance. Defaults to copying `encoding` and `objectMode` from
// the original underlying stream.
Streamist.prototype.map = function(iterator, options) {
  return this.mapParallel(1, iterator, options);
};

// ### Streamist#mapParallel(maxConcurrent, iterator, [options])

// See `Streamist#map(iterator, [options])`.
Streamist.prototype.mapParallel = function(maxConcurrent, iterator, options) {
  return this._streamResults(
    maxConcurrent, iterator, util.testMapResult, options);
};

// ### Streamist#filter(iterator)

// Filters each chunk in the underlying stream using `iterator`. The returned
// `Streamist` instance will only stream those chunks for which `iterator`
// returned a truey (promise fulfillment) value.
Streamist.prototype.filter = function(iterator) {
  return this.filterParallel(1, iterator);
};

// ### Streamist#filterParallel(maxConcurrent, iterator)

// See `Streamist#filter(iterator)`.
Streamist.prototype.filterParallel = function(maxConcurrent, iterator) {
  return this._streamResults(maxConcurrent, iterator, util.testFilterResult);
};

// ### Streamist#filterOut(iterator)

// Filters each chunk in the underlying stream using `iterator`. The returned
// `Streamist` instance will only stream those chunks for which `iterator`
// returned a falsey (promise fulfillment) value.
Streamist.prototype.filterOut = function(iterator) {
  return this.filterOutParallel(1, iterator);
};

// ### Streamist#filterOutParallel(maxConcurrent, iterator)

// See `Streamist#filterOut(iterator)`.
Streamist.prototype.filterOutParallel = function(maxConcurrent, iterator) {
  return this._streamResults(maxConcurrent, iterator, util.testFilterOutResult);
};
