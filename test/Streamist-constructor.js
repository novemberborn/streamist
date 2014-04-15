'use strict';

var Thenstream = require('thenstream').Thenstream;
var Promise = require('legendary').Promise;

var sinon = require('sinon');

var Streamist = require('../').Streamist;

describe('Streamist(streamOrThenable)', function() {
  var stream;
  beforeEach(function() {
    stream = new stubs.Readable();
  });

  describe('when passed a stream', function() {
    it('exposes that stream as `.stream`', function() {
      assert.matchingSentinels(new Streamist(stream).stream, stream);
    });
  });

  describe('when passed something that’s not a stream', function() {
    it('exposes a Thenstream instance as `.stream`', function() {
      assert.instanceOf(
        new Streamist(Promise.from(stream)).stream, Thenstream);
    });

    describe('if the “something” is a rejected promise', function() {
      it('rejects the `.complete` promise', function() {
        return assert.isRejected(
          new Streamist(Promise.rejected(sentinels.foo)).complete,
          sentinels.Sentinel);
      });
    });

    describe('if the “something” is not a thenable for a stream', function() {
      it('rejects the `.complete` promise with a `TypeError', function() {
        return assert.isRejected(
          new Streamist(Promise.from(sentinels.foo)).complete,
          TypeError);
      });
    });
  });

  describe('the `.complete` promise', function() {
    it('is created', function() {
      assert.instanceOf(new Streamist(stream).complete, Promise);
    });

    it('fulfils when the stream ends', function() {
      var s = new Streamist(stream);
      stream.emitEnd();
      return assert.eventually.isTrue(s.complete);
    });

    it('rejects when the stream errors', function() {
      var s = new Streamist(stream);
      stream.emitError(sentinels.foo);
      return assert.isRejected(s.complete, sentinels.Sentinel);
    });

    describe('when cancelled', function() {
      it('cleans up stream listeners', function() {
        var spy = sinon.spy(stream, 'removeListener');
        new Streamist(stream).complete.cancel();
        assert.calledWithMatch(spy, 'end', sinon.match.func);
        assert.calledWithMatch(spy, 'error', sinon.match.func);
      });
    });
  });
});
