'use strict';

var Sentinel = require('chai-sentinels').Sentinel;
var EventEmitter = require('events').EventEmitter;
var blessObject = require('legendary').blessObject;

var instanceCount = 0;

exports.Readable = function(label) {
  instanceCount++;
  if (!label) {
    label = 'stubbed-readable-' + instanceCount;
  }

  var emitter = new EventEmitter();
  return new Sentinel(label, {
    _readableState: {
      value: {}
    },
    read: {
      value: function() { return null; },
      writable: true
    },
    on: {
      value: emitter.on.bind(emitter),
      writable: true
    },
    once: {
      value: emitter.once.bind(emitter),
      writable: true
    },
    removeListener: {
      value: emitter.removeListener.bind(emitter),
      writable: true
    },
    emitEnd: {
      value: function() { emitter.emit('end'); }
    },
    emitError: {
      value: function(arg) { emitter.emit('error', arg); }
    },
    emitReadable: {
      value: function() { emitter.emit('readable'); }
    }
  });
};

exports.Promise = function(label, executor) {
  instanceCount++;
  if (!label) {
    label = 'stubbed-promise-' + instanceCount;
  }

  var s = new Sentinel(label, {
    then: {
      get: function() { return function() { return s; }; },
      set: function() {}
    }
  });
  blessObject(s, executor || function() {});
  return s;
};
