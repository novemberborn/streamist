'use strict';

var Promise = require('legendary').Promise;

exports.isStreamLike = function(obj) {
  return obj && typeof obj === 'object' &&
    obj._readableState && typeof obj._readableState === 'object' &&
    typeof obj.read === 'function';
};

exports.getStreamOptions = function(readable) {
  var state = readable._readableState;
  return {
    encoding: state.encoding,
    objectMode: state.objectMode
  };
};

exports.extractValue = function(object) {
  return object.value;
};

exports.makeUndefined = function() {
  return undefined;
};

exports.makeTrue = function() {
  return true;
};

exports.makeFalse = function() {
  return false;
};

var STREAM_CHUNK_INSTEAD = exports.STREAM_CHUNK_INSTEAD = {};

exports.invokeCancel = function(promise) {
  promise.cancel();
};

exports.testMapResult = function(result) {
  if (result === null || typeof result === 'undefined') {
    throw new TypeError('Cannot map to a null or undefined value.');
  }

  return true;
};

exports.testFilterResult = function(result) {
  return result && STREAM_CHUNK_INSTEAD;
};

exports.testFilterOutResult = function(result) {
  return !result && STREAM_CHUNK_INSTEAD;
};

function Shortcut(value) {
  this.value = value;
}
exports.Shortcut = Shortcut;

var TRUE_SHORTCUT = exports.TRUE_SHORTCUT = new Shortcut(true);
var FALSE_SHORTCUT = exports.FALSE_SHORTCUT = new Shortcut(false);

exports.shortcutDetect = function(iterator) {
  return function(item) {
    var result = iterator(item);
    if (Promise.isInstance(result)) {
      return result.then(function(result) {
        if (result) {
          throw new Shortcut(item);
        }
      });
    } else if (result) {
      throw new Shortcut(item);
    }
  };
};

exports.shortcutSome = function(iterator) {
  return function(item) {
    var result = iterator(item);
    if (Promise.isInstance(result)) {
      return result.then(function(result) {
        if (result) {
          throw TRUE_SHORTCUT;
        }
      });
    } else if (result) {
      throw TRUE_SHORTCUT;
    }
  };
};

exports.shortcutNotEvery = function(iterator) {
  return function(item) {
    var result = iterator(item);
    if (Promise.isInstance(result)) {
      return result.then(function(result) {
        if (!result) {
          throw FALSE_SHORTCUT;
        }
      });
    } else if (!result) {
      throw FALSE_SHORTCUT;
    }
  };
};

exports.extractShortcutValue = function(reason) {
  if (reason instanceof Shortcut) {
    return reason.value;
  }
  throw reason;
};
