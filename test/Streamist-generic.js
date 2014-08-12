'use strict';

var Promise = require('legendary').Promise;
var Series = require('legendary').Series;
var delay = require('legendary').timed.delay;
var CancellationError = require('legendary').CancellationError;
var Thenable = require('legendary/test/support/Thenable');

var sinon = require('sinon');
var StreamArray = require('stream-array');

var Streamist = require('../').Streamist;
var UnreadableStreamError = require('../').UnreadableStreamError;
var EndOfStreamError = require('../').EndOfStreamError;

describe('Generic Streamist instance methods:', function() {
  var stream;
  beforeEach(function() {
    stream = new stubs.Readable();
  });

  describe('#cancel()', function() {
    it('is an alias for `#complete.cancel()`', function() {
      var instance = new Streamist(stream);
      assert.strictEqual(instance.cancel, instance.complete.cancel);
    });
  });

  describe('#consumeObject(size)', function() {
    var sizes = {
      one: new sentinels.Sentinel('size-one'),
      two: new sentinels.Sentinel('size-two')
    };

    var instance;
    beforeEach(function() {
      instance = new Streamist(stream);
    });

    it('passes `size` to the stream', function() {
      var spy = sinon.spy(stream, 'read');
      instance.consumeObject(sizes.one);
      assert.calledOnce(spy);
      assert.calledWithExactly(spy, sizes.one);
    });

    describe('when the stream is no longer readable', function() {
      it('returns a promise rejected with `UnreadableStreamError', function() {
        stream.emitEnd();
        var p = instance.consumeObject();
        assert.instanceOf(p, Promise);
        return assert.isRejected(p, UnreadableStreamError);
      });
    });

    describe('when the stream has a chunk available', function() {
      it('returns a promise fulfilled with an object wrapper for that chunk',
        function() {
          sinon.stub(stream, 'read').returns(sentinels.foo);
          var p = instance.consumeObject();
          assert.instanceOf(p, Promise);
          return assert.eventually.deepEqual(p, { value: sentinels.foo });
        });
    });

    describe('when no chunks are available', function() {
      var read, pending;
      beforeEach(function() {
        read = sinon.stub(stream, 'read')
          .onFirstCall().returns(null)
          .onSecondCall().returns(sentinels.foo)
          .onThirdCall().returns(sentinels.bar);
        pending = instance.consumeObject(sizes.one);
      });

      it('returns a pending promise', function() {
        assert.instanceOf(pending, Promise);
        assert.deepEqual(pending.inspectState(), {
          isFulfilled: false,
          isRejected: false
        });
      });

      describe('the pending promise', function() {
        it('rejects with `EndOfStreamError` when the stream ends', function() {
          stream.emitEnd();
          return assert.isRejected(pending, EndOfStreamError);
        });

        it('rejects when the stream emits an error', function() {
          stream.emitError(sentinels.foo);
          return assert.isRejected(pending, sentinels.Sentinel);
        });

        it('fulfills with the next (wrapped) `size` chunk after the stream ' +
          'becomes readable',
          function() {
            stream.emitReadable();
            return delay().then(function() {
              assert.matchingSentinels(read.stub.secondCall.args, [sizes.one]);
              return assert.eventually.deepEqual(
                pending, { value: sentinels.foo });
            });
          });

        it('is cancelled if the instance itself is cancelled', function() {
          instance.cancel();
          return assert.isRejected(pending, CancellationError);
        });
      });

      describe('when called again', function() {
        it('still returns a pending promise', function() {
          var p = instance.consumeObject(sizes.two);
          assert.instanceOf(p, Promise);
          assert.deepEqual(p.inspectState(), {
            isFulfilled: false,
            isRejected: false
          });
        });

        describe('and a chunk is available without the stream signalling so',
          function() {
            it('still returns a pending promise', function() {
              read.stub.restore();
              sinon.stub(stream, 'read').returns(sentinels.foo);
              var p = instance.consumeObject(sizes.two);
              assert.instanceOf(p, Promise);
              assert.deepEqual(p.inspectState(), {
                isFulfilled: false,
                isRejected: false
              });
            });
          });

        describe('the second pending promise', function() {
          var againPending;
          beforeEach(function() {
            againPending = instance.consumeObject(sizes.two);
          });

          it('rejects with `EndOfStreamError` when the stream ends',
            function() {
              stream.emitEnd();
              return assert.isRejected(againPending, EndOfStreamError);
            });

          it('rejects with `EndOfStreamError` if the stream has ended with ' +
            'the first chunk',
            function() {
              stream.emitReadable();
              stream.emitEnd();
              return assert.isRejected(againPending, EndOfStreamError);
            });

          it('rejects when the stream emits an error', function() {
            stream.emitError(sentinels.foo);
            return assert.isRejected(againPending, sentinels.Sentinel);
          });

          it('fulfills with the second (wrapped) `size` chunk after the ' +
            'stream becomes readable',
            function() {
              stream.emitReadable();
              return pending.then(function() {
                assert.matchingSentinels(read.stub.thirdCall.args, [sizes.two]);
                return assert.eventually.deepEqual(
                  againPending, { value: sentinels.bar });
              });
            });

          it('is cancelled if the instance itself is cancelled', function() {
            instance.cancel();
            return assert.isRejected(againPending, CancellationError);
          });

          describe('if the first pending promise is cancelled', function() {
            it('fulfills with the first (wrapped) `size` chunk after the ' +
              'stream becomes readable',
              function() {
                pending.cancel();
                stream.emitReadable();
                return delay(10).then(function() {
                  assert.matchingSentinels(
                    read.stub.secondCall.args, [sizes.two]);
                  return assert.eventually.deepEqual(
                    againPending, { value: sentinels.foo });
                });
              });
          });
        });
      });
    });
  });

  describe('#consume(size)', function() {
    var instance;
    beforeEach(function() {
      instance = new Streamist(stream);
    });

    it('relies on `.consumeObject(size)`', function() {
      var p = new stubs.Promise('consumeObject');
      var coStub = sinon.stub(instance, 'consumeObject')
        .onFirstCall().returns(p);

      assert.strictEqual(instance.consume(sentinels.foo), p);
      assert.calledOnce(coStub.stub);
      assert.calledWithExactly(coStub.stub, sentinels.foo);
    });
  });

  describe('#toArray(constructor)', function() {
    var chunks, instance;
    beforeEach(function() {
      chunks = sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    describe('chunks are not promises or thenables', function() {
      it('promises an array containing all chunks', function() {
        var p = instance.toArray();
        assert.instanceOf(p, Promise);
        return assert.eventually.matchingSentinels(p, chunks);
      });
    });

    describe('chunks are promises or thenables', function() {
      it('promises an array containing all chunks, as-is', function() {
        chunks[0] = Promise.from(chunks[0]);
        chunks[1] = new Thenable(function(resolve) { resolve(chunks[1]); });
        var instance = new Streamist(new StreamArray(chunks.slice()));

        var p = instance.toArray();
        assert.instanceOf(p, Promise);
        return p.then(function(arr) {
          assert.strictEqual(arr[0], chunks[0]);
          assert.strictEqual(arr[1], chunks[1]);
          assert.matchingSentinels(arr[2], chunks[2]);
        });
      });
    });

    it('`constructor` defaults to `Series`', function() {
      assert.instanceOf(instance.toArray(), Series);
    });

    it('uses `constructor` to cast returned promise', function() {
      var mock = sinon.mock({ from: function() {} });
      mock.expects('from').returns(sentinels.foo);
      assert.matchingSentinels(instance.toArray(mock.object), sentinels.foo);
    });

    it('uses #each() for the iteration', function() {
      var spy = sinon.spy(instance, 'each');
      instance.toArray();
      assert.calledOnce(spy);
    });
  });

  describe('#toBuffer(length)', function() {
    var chunks, instance;
    beforeEach(function() {
      chunks = ['foo', 'bar', 'baz'].map(function(str) {
        return new Buffer(str);
      });
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    it('promises a buffer for all chunks', function() {
      var p = instance.toBuffer();
      assert.instanceOf(p, Promise);
      return assert.eventually.deepEqual(p, new Buffer('foobarbaz'));
    });

    describe('when `length` is provided', function() {
      describe('and it matches the combined length of all chunks', function() {
        it('results in a buffer with that length', function() {
          return assert.eventually.deepEqual(
            instance.toBuffer(9),
            new Buffer('foobarbaz'));
        });
      });

      describe('and it exceeds the combined length of all chunks', function() {
        it('results in a buffer with that length', function() {
          var p = instance.toBuffer(10);
          return Promise.join(
            assert.eventually.lengthOf(p, 10),
            assert.eventually.deepEqual(
              p.send('slice', 0, 9),
              new Buffer('foobarbaz'))
          );
        });
      });

      describe('and it is too small to fit all chunks',
        function() {
          it('rejects the returned promise with a `RangeError`', function() {
            return assert.isRejected(instance.toBuffer(6), RangeError);
          });
        });

      describe('and it fits the last chunk only partly', function() {
        it('results in a buffer with the last chunk truncated', function() {
          return assert.eventually.deepEqual(
            instance.toBuffer(7),
            new Buffer('foobarb'));
        });
      });
    });

    it('uses #each() for the iteration', function() {
      var spy = sinon.spy(instance, 'each');
      instance.toBuffer();
      assert.calledOnce(spy);
    });
  });
});
