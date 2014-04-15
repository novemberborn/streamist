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

function identity(x) { return x; }

describe('Non-streaming Streamist iteration instance methods:', function() {
  var stream, instance;
  beforeEach(function() {
    stream = new stubs.Readable();
    instance = new Streamist(stream);
  });

  describe('#each(iterator)', function() {
    it('relies on `eachParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var ep = sinon.stub(instance, 'eachParallel').returns(sentinels.foo);
      assert.matchingSentinels(instance.each(identity), sentinels.foo);
      assert.calledWithExactly(ep, 1, identity);
    });
  });

  describe('#eachParallel(maxConcurrent, iterator)', function() {
    describe('if `maxConcurrent` is not a number', function() {
      it('returns a rejected promise', function() {
        var done = instance.eachParallel();
        assert.instanceOf(done, Promise);
        return assert.isRejected(done, TypeError);
      });
    });

    describe('if `iterator` is not a function', function() {
      it('returns a rejected promise', function() {
        var done = instance.eachParallel(1);
        assert.instanceOf(done, Promise);
        return assert.isRejected(done, TypeError);
      });
    });

    describe('when the stream is no longer readable', function() {
      it('returns a promise rejected with `UnreadableStreamError', function() {
        stream.emitEnd();
        var done = instance.eachParallel(1, function() {});
        assert.instanceOf(done, Promise);
        return assert.isRejected(done, UnreadableStreamError);
      });
    });

    describe('consumption of the stream', function() {
      it('starts in a future turn', function() {
        var read = sinon.stub(stream, 'read').returns(null);

        instance.eachParallel(1, function() {});
        assert.notCalled(read);

        return delay(10).then(function() {
          assert.calledOnce(read);
        });
      });

      it('relies on `.consumeObject()`', function() {
        var chunks = {
          first: Promise.from({ value: sentinels.foo }),
          second: Promise.from({ value: sentinels.bar })
        };

        sinon.stub(instance, 'consumeObject')
          .onFirstCall().returns(chunks.first)
          .onSecondCall().returns(chunks.second)
          .onThirdCall().returns(Promise.rejected(new EndOfStreamError()));

        var iterator = sinon.spy();
        var done = instance.eachParallel(1, iterator);

        return delay(10).yield(chunks.first).then(function() {
          assert.calledWithExactly(iterator, sentinels.foo);
          return chunks.second;
        }).then(function() {
          assert.calledWithExactly(iterator, sentinels.bar);
          stream.emitEnd();
          return done;
        }).then(function() {
          assert.calledTwice(iterator);
        });
      });

      it('does not assimilate promises or thenables from the stream',
        function() {
          var values = {
            first: Promise.from(sentinels.foo),
            second: new Thenable(function(resolve) { resolve(sentinels.bar); })
          };
          var chunks = {
            first: Promise.from({ value: values.first }),
            second: Promise.from({ value: values.second })
          };

          sinon.stub(instance, 'consumeObject')
            .onFirstCall().returns(chunks.first)
            .onSecondCall().returns(chunks.second)
            .onThirdCall().returns(Promise.rejected(new EndOfStreamError()));

          var iterator = sinon.spy();
          var done = instance.eachParallel(1, iterator);

          return delay(10).yield(chunks.first).then(function() {
            assert.calledWithExactly(iterator, values.first);
            return chunks.second;
          }).then(function() {
            assert.calledWithExactly(iterator, values.second);
            stream.emitEnd();
            return done;
          }).then(function() {
            assert.calledTwice(iterator);
          });
        });

      it('respects the max concurrency', function() {
        function testIteration(iterationIndex, allSpies) {
          // Only previous iterators should have been called.
          allSpies.forEach(function(spy, spyIndex) {
            if (spyIndex < iterationIndex) {
              assert.called(spy);
            } else if (spyIndex > iterationIndex) {
              assert.notCalled(spy);
            }
          });

          return delay().then(function() {
            // Given concurrency of 2, previous and the *next*
            // iterator should have been called.
            allSpies.forEach(function(spy, spyIndex) {
              if (
                spyIndex < iterationIndex ||
                spyIndex === iterationIndex + 1
              ) {
                assert.called(spy);
              } else if (spyIndex > iterationIndex) {
                assert.notCalled(spy);
              }
            });
          });
        }

        var spies = [];
        for (var i = 0; i < 10; i++) {
          spies.push(sinon.spy(testIteration));
        }

        var index = 0;
        var instance = new Streamist(new StreamArray(spies.slice()));
        return instance.eachParallel(2, function(spy) {
          return spy(index++, spies);
        });
      });
    });

    describe('returns a promise for when the consumption is done', function() {
      var done;
      beforeEach(function() {
        done = instance.eachParallel(1, function() {});
      });

      it('is pending initially', function() {
        assert.instanceOf(done, Promise);
        assert.deepEqual(done.inspectState(), {
          isFulfilled: false,
          isRejected: false
        });
      });

      describe('when the stream ends', function() {
        it('is fulfilled with `undefined`', function() {
          stream.emitEnd();
          return assert.eventually.isUndefined(done);
        });
      });

      describe('when the stream emits `error`', function() {
        it('is rejected', function() {
          stream.emitError(sentinels.foo);
          return assert.isRejected(done, sentinels.foo);
        });
      });

      describe('when waiting for data and the instance itself is cancelled',
        function() {
          it('is rejected (because the promise it’s waiting on is)',
            function() {
              instance.cancel();
              return assert.isRejected(done, CancellationError);
            });
        });

      describe('when an iterator throws', function() {
        it('is rejected', function() {
          sinon.stub(instance, 'consumeObject').returns(
            Promise.from({ value: sentinels.foo }));
          done = instance.eachParallel(1, function(x) {
            throw x;
          });
          return assert.isRejected(done, sentinels.Sentinel);
        });
      });

      describe('when an iterator returns a rejected promise', function() {
        it('is rejected', function() {
          sinon.stub(instance, 'consumeObject').returns(
            Promise.from({ value: sentinels.foo }));
          var done = instance.eachParallel(1, function(x) {
            return Promise.rejected(x);
          });
          return assert.isRejected(done, sentinels.Sentinel);
        });
      });

      describe('while an iterator-returned promise is pending', function() {
        it('(the “done” promise) remains pending, too', function() {
          sinon.stub(instance, 'consumeObject').returns(
            Promise.from({ value: sentinels.foo }));

          var resolve;
          var pending = new Promise(function(r) { resolve = r; });

          var done = instance.eachParallel(1, function() {
            return pending;
          });

          return delay(10).then(function() {
            assert.deepEqual(done.inspectState(), {
              isFulfilled: false,
              isRejected: false
            });

            stream.emitEnd();
            resolve();
            return assert.eventually.isUndefined(done);
          });
        });
      });

      describe('when it’s cancelled', function() {
        it('also cancels any pending iterator-returned promises', function() {
          var instance = new Streamist(stream);

          var firstSpy = sinon.spy();
          var secondSpy = sinon.spy();

          sinon.stub(instance, 'consumeObject')
            .onFirstCall().returns(Promise.from({ value: firstSpy }))
            .onSecondCall().returns(Promise.from({ value: secondSpy }))
            .onThirdCall().returns(new Promise(function() {}));

          var done = instance.eachParallel(2, function(onCancelled) {
            return new Promise(function() {
              return onCancelled;
            });
          });

          return delay(10).then(function() {
            done.cancel();
            return delay();
          }).then(function() {
            assert.called(firstSpy);
            assert.called(secondSpy);
          });
        });
      });
    });

    describe('thenables returned by iterators', function() {
      it('are not assimilated', function() {
        sinon.stub(instance, 'consumeObject').returns(
          Promise.from({ value: sentinels.foo }));
        var done = instance.eachParallel(1, function(x) {
          stream.emitEnd();
          return new Thenable(function(_, reject) {
            reject(x);
          });
        });
        return assert.eventually.isUndefined(done);
      });
    });
  });

  describe('#detect(iterator)', function() {
    it('relies on `detectParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var dp = sinon.stub(instance, 'detectParallel').returns(sentinels.foo);
      assert.matchingSentinels(instance.detect(identity), sentinels.foo);
      assert.calledWithExactly(dp, 1, identity);
    });
  });

  describe('#detectParallel(maxConcurrent, iterator)', function() {
    var chunks, instance;
    beforeEach(function() {
      chunks = new sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    it('relies on `eachParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var promise = new stubs.Promise();
      var ep = sinon.stub(instance, 'eachParallel').returns(promise);
      assert.matchingSentinels(
        instance.detectParallel(sentinels.foo, identity), promise);
      assert.calledWithMatch(ep, sentinels.foo, sinon.match.func);
    });

    describe('when no iterator returns a truey zalue', function() {
      it('results in a promise that’s fulfilled with `undefined`', function() {
        return assert.eventually.isUndefined(
          instance.detectParallel(1, function() { return false; }));
      });
    });

    describe('when an iterator returns a truey value', function() {
      it('detects that chunk', function() {
        return assert.eventually.matchingSentinels(
          instance.detectParallel(1, function(x) { return x === chunks[1]; }),
          chunks[1]);
      });

      it('halts iteration', function() {
        var spy = sinon.spy(function(x) { return x === chunks[1]; });
        return instance.detectParallel(1, spy).then(function() {
          assert.calledTwice(spy);
          assert.calledWithExactly(spy, chunks[0]);
          assert.calledWithExactly(spy, chunks[1]);
        });
      });
    });

    describe('when the iterator returns a promise', function() {
      describe('and that promise fulfills', function() {
        it('detects the chunk if the fulfillment value is truey', function() {
          return assert.eventually.matchingSentinels(
            instance.detectParallel(1, function(x) {
              return Promise.from(x === chunks[1]);
            }),
            chunks[1]);
        });

        it('does not detect a value if the fulfillment value is falsey',
          function() {
            return assert.eventually.isUndefined(
              instance.detectParallel(1, function() {
                return Promise.from(false);
              }));
          });
      });

      describe('and that promise rejects', function() {
        describe('the `someParallel()` returned promise', function() {
          it('is also rejected', function() {
            return assert.isRejected(
              instance.detectParallel(1, function() {
                return Promise.rejected(sentinels.foo);
              }),
              sentinels.Sentinel);
          });
        });
      });

      describe('and the promise returned by `detectParallel()` is cancelled',
        function() {
          it('also cancels the promise returned by the iterator', function() {
            var pending = new Promise(function() {});
            var p = instance.detectParallel(1, function() { return pending; });
            setImmediate(p.cancel);
            return assert.isRejected(pending, CancellationError);
          });
        });
    });

    describe('when the iterator returns a thenable', function() {
      it('is treated as a truey value', function() {
        return assert.eventually.matchingSentinels(
          instance.detectParallel(1, function() {
            return new Thenable(function(resolve) { resolve(false); });
          }),
          chunks[0]);
      });
    });

    describe('if the detected chunk is actually a promise', function() {
      describe('that is fulfilled', function() {
        describe('the returned promise', function() {
          it('is fulfilled with the the eventual value', function() {
            var instance = new Streamist(new StreamArray([
              Promise.from(sentinels.foo)
            ]));

            return assert.eventually.matchingSentinels(
              instance.detectParallel(1, function() { return true; }),
              sentinels.foo);
          });
        });
      });

      describe('that is rejected', function() {
        describe('the returned promise', function() {
          it('is rejected with the the eventual reason', function() {
            var p1 = Promise.rejected(new Error());
            var p2 = Promise.rejected(sentinels.foo);
            var instance = new Streamist(new StreamArray([p1, p2]));

            return assert.isRejected(
              instance.detectParallel(1, function(x) { return x === p2; }),
              sentinels.Sentinel);
          });
        });
      });
    });

    describe('if the detected chunk is actually a thenable', function() {
      describe('that is fulfilled', function() {
        describe('the returned promise', function() {
          it('is fulfilled with the the eventual value', function() {
            var instance = new Streamist(new StreamArray([
              new Thenable(function(resolve) { resolve(sentinels.foo); })
            ]));

            return assert.eventually.matchingSentinels(
              instance.detectParallel(1, function() { return true; }),
              sentinels.foo);
          });
        });
      });

      describe('that is rejected', function() {
        describe('the returned promise', function() {
          it('is rejected with the the eventual reason', function() {
            var p1 = new Thenable(function(_, reject) {
              reject(new Error());
            });
            var p2 = new Thenable(function(_, reject) {
              reject(sentinels.foo);
            });
            var instance = new Streamist(new StreamArray([p1, p2]));

            return assert.isRejected(
              instance.detectParallel(1, function(x) { return x === p2; }),
              sentinels.Sentinel);
          });
        });
      });
    });
  });

  describe('#some(iterator)', function() {
    it('relies on `someParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var sp = sinon.stub(instance, 'someParallel').returns(sentinels.foo);
      assert.matchingSentinels(instance.some(identity), sentinels.foo);
      assert.calledWithExactly(sp, 1, identity);
    });
  });

  describe('#someParallel(maxConcurrent, iterator)', function() {
    var chunks, instance;
    beforeEach(function() {
      chunks = new sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    it('relies on `eachParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var promise = new stubs.Promise();
      var ep = sinon.stub(instance, 'eachParallel').returns(promise);
      assert.matchingSentinels(
        instance.someParallel(sentinels.foo, identity), promise);
      assert.calledWithMatch(ep, sentinels.foo, sinon.match.func);
    });

    describe('when no iterator returns a truey zalue', function() {
      it('results in a promise that’s fulfilled with `false`', function() {
        return assert.eventually.isFalse(
          instance.someParallel(1, function() { return false; }));
      });
    });

    describe('when an iterator returns a truey value', function() {
      it('results in a promise that’s fulfilled with `true`', function() {
        return assert.eventually.isTrue(
          instance.someParallel(1, function(x) { return x === chunks[1]; }));
      });

      it('halts iteration', function() {
        var spy = sinon.spy(function(x) { return x === chunks[1]; });
        return instance.someParallel(1, spy).then(function() {
          assert.calledTwice(spy);
          assert.calledWithExactly(spy, chunks[0]);
          assert.calledWithExactly(spy, chunks[1]);
        });
      });
    });

    describe('when iterators return a promise', function() {
      describe('and that promise fulfills with a truey value', function() {
        describe('the `someParallel()` returned promise', function() {
          it('is fulfilled with `true`', function() {
            return assert.eventually.isTrue(
              instance.someParallel(1, function(x) {
                return Promise.from(x === chunks[1]);
              }));
          });
        });
      });

      describe('and that promise fulfills with a falsey value', function() {
        describe('the `someParallel()` returned promise', function() {
          it('is fulfilled with `false`', function() {
            return assert.eventually.isFalse(
              instance.someParallel(1, function() {
                return Promise.from(false);
              }));
          });
        });
      });

      describe('and that promise rejects', function() {
        describe('the `someParallel()` returned promise', function() {
          it('is also rejected', function() {
            return assert.isRejected(
              instance.someParallel(1, function() {
                return Promise.rejected(sentinels.foo);
              }),
              sentinels.Sentinel);
          });
        });
      });

      describe('and the promise returned by `someParallel()` is cancelled',
        function() {
          it('also cancels the promise returned by the iterator', function() {
            var pending = new Promise(function() {});
            var p = instance.someParallel(1, function() { return pending; });
            setImmediate(p.cancel);
            return assert.isRejected(pending, CancellationError);
          });
        });
    });

    describe('when the iterator returns a thenable', function() {
      it('is treated as a truey value', function() {
        return assert.eventually.isTrue(
          instance.someParallel(1, function() {
            return new Thenable(function(resolve) { resolve(false); });
          }));
      });
    });
  });

  describe('#every(iterator)', function() {
    it('relies on `everyParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var ep = sinon.stub(instance, 'everyParallel').returns(sentinels.foo);
      assert.matchingSentinels(instance.every(identity), sentinels.foo);
      assert.calledWithExactly(ep, 1, identity);
    });
  });

  describe('#everyParallel(maxConcurrent, iterator)', function() {
    var chunks, instance;
    beforeEach(function() {
      chunks = new sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    it('relies on `eachParallel()`', function() {
      var instance = new Streamist(new stubs.Readable());
      var promise = new stubs.Promise();
      var ep = sinon.stub(instance, 'eachParallel').returns(promise);
      assert.matchingSentinels(
        instance.everyParallel(sentinels.foo, identity), promise);
      assert.calledWithMatch(ep, sentinels.foo, sinon.match.func);
    });

    describe('when only some iterators return a truey zalue', function() {
      it('results in a promise that’s fulfilled with `false`', function() {
        return assert.eventually.isFalse(
          instance.everyParallel(1, function(x) { return x === chunks[1]; }));
      });

      it('halts iteration', function() {
        var spy = sinon.spy(function(x) { return x !== chunks[1]; });
        return instance.everyParallel(1, spy).then(function() {
          assert.calledTwice(spy);
          assert.calledWithExactly(spy, chunks[0]);
          assert.calledWithExactly(spy, chunks[1]);
        });
      });
    });

    describe('when all iterators return a truey value', function() {
      it('results in a promise that’s fulfilled with `true`', function() {
        return assert.eventually.isTrue(
          instance.everyParallel(1, function() { return true; }));
      });
    });

    describe('when iterators return a promise', function() {
      describe('and that promise fulfills with a truey value', function() {
        describe('the `everyParallel()` returned promise', function() {
          it('is fulfilled with `true`', function() {
            return assert.eventually.isTrue(
              instance.everyParallel(1, function() {
                return Promise.from(true);
              }));
          });
        });
      });

      describe('and that promise fulfills with a falsey value', function() {
        describe('the `everyParallel()` returned promise', function() {
          it('it fulfilled with `false`', function() {
            return assert.eventually.isFalse(
              instance.everyParallel(1, function(x) {
                return Promise.from(x === chunks[1]);
              }));
          });
        });
      });

      describe('and that promise rejects', function() {
        describe('the `everyParallel()` returned promise', function() {
          it('is also rejected', function() {
            return assert.isRejected(
              instance.everyParallel(1, function() {
                return Promise.rejected(sentinels.foo);
              }),
              sentinels.Sentinel);
          });
        });
      });

      describe('and the promise returned by `everyParallel()` is cancelled',
        function() {
          it('also cancels the promise returned by the iterator', function() {
            var pending = new Promise(function() {});
            var p = instance.everyParallel(1, function() { return pending; });
            setImmediate(p.cancel);
            return assert.isRejected(pending, CancellationError);
          });
        });
    });

    describe('when the iterator returns a thenable', function() {
      it('is treated as a truey value', function() {
        return assert.eventually.isTrue(
          instance.everyParallel(1, function() {
            return new Thenable(function(resolve) { resolve(false); });
          }));
      });
    });
  });

  describe('#foldl(initialValue, iterator)', function() {
    var chunks, instance;
    beforeEach(function() {
      chunks = new sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    describe('when `initialValue` is a promise', function() {
      it('first assimilates that promise', function() {
        var resolve;
        var pending = new Promise(function(r) { resolve = r; });

        var spy = sinon.stub().returns(sentinels.foo);
        var p = instance.foldl(pending, spy);

        resolve(sentinels.bar);
        return pending.then(function() {
          assert.notCalled(spy);
          return p;
        }).then(function() {
          assert.calledWith(spy, sentinels.bar);
        });
      });

      describe('when it’s a subclass of Promise', function() {
        it('still returns just a Promise', function() {
          var p = instance.foldl(Series.from([]), identity);
          assert.instanceOf(p, Promise);
          assert.notInstanceOf(p, Series);
        });
      });

      describe('when it rejects', function() {
        describe('the `foldl()` returned promise', function() {
          it('is also rejected', function() {
            return assert.isRejected(
              instance.foldl(Promise.rejected(sentinels.foo), identity),
              sentinels.Sentinel);
          });
        });
      });
    });

    describe('when `initialValue` is a thenable', function() {
      it('first assimilates that thenable', function() {
        var resolve;
        var pending = new Thenable(function(r) { resolve = r; });

        var spy = sinon.stub().returns(sentinels.foo);
        var p = instance.foldl(pending, spy);

        resolve(sentinels.bar);
        return pending.then(function() {
          assert.notCalled(spy);
          return p;
        }).then(function() {
          assert.calledWith(spy, sentinels.bar);
        });
      });

      describe('when it rejects', function() {
        describe('the `foldl()` returned promise', function() {
          it('is also rejected', function() {
            var rejected = new Thenable(function(_, reject) {
              reject(sentinels.foo);
            });
            return assert.isRejected(
              instance.foldl(rejected, identity),
              sentinels.Sentinel);
          });
        });
      });
    });

    describe('consumption of the stream', function() {
      it('relies on `eachParallel()`', function() {
        var spy = sinon.spy(instance, 'eachParallel');
        return instance.foldl(null, function() {}).then(function() {
          assert.calledWithMatch(spy, 1, sinon.match.func);
        });
      });

      describe('`iterator`', function() {
        it('is called with the result of the previous iteration, and the ' +
          'current chunk',
          function() {
            var spy = sinon.spy(function(_, chunk) { return chunk; });
            return instance.foldl(sentinels.foo, spy).then(function() {
              assert.calledThrice(spy);
              assert.matchingSentinels(spy.firstCall.args,
                [sentinels.foo, chunks[0]]);
              assert.matchingSentinels(spy.secondCall.args,
                [chunks[0], chunks[1]]);
              assert.matchingSentinels(spy.thirdCall.args,
                [chunks[1], chunks[2]]);
            });
          });
      });

      describe('thenables returned by `iterator`', function() {
        it('are assimilated', function() {
          var spy = sinon.spy(function(_, chunk) {
            return new Thenable(function(resolve) {
              resolve(chunk);
            });
          });
          return instance.foldl(sentinels.foo, spy).then(function() {
            assert.calledThrice(spy);
            assert.matchingSentinels(spy.firstCall.args,
              [sentinels.foo, chunks[0]]);
            assert.matchingSentinels(spy.secondCall.args,
              [chunks[0], chunks[1]]);
            assert.matchingSentinels(spy.thirdCall.args,
              [chunks[1], chunks[2]]);
          });
        });
      });
    });

    describe('the `foldl()` returned promise', function() {
      it('is fulfilled with the value returned by the final invocation of ' +
        '`iterator`',
        function() {
          return assert.eventually.matchingSentinels(
            instance.foldl(null, function(_, chunk) { return chunk; }),
            chunks[2]);
        });
    });

    describe('if the stream is empty', function() {
      describe('the `foldl()` returned promise', function() {
        it('is fulfilled with the initial value', function() {
          var stream = new stubs.Readable();
          var instance = new Streamist(stream);
          var p = instance.foldl(sentinels.foo, function() {
            return sentinels.bar;
          });

          process.nextTick(stream.emitEnd);
          return assert.eventually.matchingSentinels(p, sentinels.foo);
        });
      });
    });
  });
});
