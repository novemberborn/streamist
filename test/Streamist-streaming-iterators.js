'use strict';

var Promise = require('legendary').Promise;
var delay = require('legendary').timed.delay;
var CancellationError = require('legendary').CancellationError;
var Thenable = require('legendary/test/support/Thenable');

var sinon = require('sinon');
var StreamArray = require('stream-array');
var Readable = require('stream').Readable;

var Streamist = require('../').Streamist;
var STREAM_CHUNK_INSTEAD = require('../lib/private/util').STREAM_CHUNK_INSTEAD;

function identity(x) { return x; }
function returnTrue() { return true; }
function asPromise(v) { return Promise.from(v); }
function asThenable(v) {
  return new Thenable(function(resolve) { resolve(v); });
}

describe('Streaming Streamist iteration instance methods:', function() {
  var stream, instance;
  beforeEach(function() {
    stream = new stubs.Readable();
    stream._readableState.objectMode = true;
    instance = new Streamist(stream);
  });

  describe('#_streamResults(maxConcurrent, iterator, testResult, ' +
    'streamOptions)',
    function() {
      var returned, read;
      beforeEach(function() {
        returned = instance._streamResults(1, identity, returnTrue);
        read = sinon.stub(stream, 'read').returns(null);
      });

      it('returns a new Streamist instance', function() {
        assert.notEqual(returned, instance);
        assert.instanceOf(returned, Streamist);
      });

      describe('the returned instance', function() {
        it('has its own stream', function() {
          assert.property(returned, 'stream');
        });

        describe('the stream', function() {
          it('is a stream.Readable', function() {
            assert.instanceOf(returned.stream, Readable);
          });

          describe('when no `streamOptions` are passed', function() {
            it('inherits `encoding` from the instance stream', function() {
              stream._readableState.encoding = 'utf8';
              assert.equal(
                instance._streamResults().stream._readableState.encoding,
                'utf8');
            });

            it('inherits `objectMode` from the instance stream', function() {
              assert.isTrue(returned.stream._readableState.objectMode);
              stream._readableState.objectMode = false;
              assert.isFalse(
                instance._streamResults().stream._readableState.objectMode);
            });
          });

          describe('when `streamOptions` are passed', function() {
            it('is created with those options', function() {
              var returned = instance._streamResults(null, null, null, {
                encoding: 'utf8',
                objectMode: true,
                highWaterMark: 42
              });
              var state = returned.stream._readableState;

              assert.propertyVal(state, 'encoding', 'utf8');
              assert.propertyVal(state, 'objectMode', true);
              assert.propertyVal(state, 'highWaterMark', 42);
            });
          });
        });
      });

      describe('consumption of the input stream', function() {
        it('does not start until the returned instance is consumed',
          function(done) {
            assert.notCalled(read);
            returned.consume();

            setTimeout(function() {
              assert.calledOnce(read);
              done();
            }, 10);
          });

        it('relies on `eachParallel()`', function(done) {
          var returned = instance._streamResults(sentinels.foo, function() {});
          var spy = sinon.spy(instance, 'eachParallel');
          returned.consume();

          setTimeout(function() {
            assert.calledOnce(spy);
            assert.calledWithMatch(spy, sentinels.foo, sinon.match.func);
            done();
          }, 10);
        });

        describe('causes `iterator` to be called', function() {
          it('is called for each chunk', function() {
            var chunks = sentinels.stubArray();
            var instance = new Streamist(new StreamArray(chunks.slice()));

            var spy = sinon.spy(identity);
            var done = instance._streamResults(1, spy, returnTrue).toArray();

            return done.then(function() {
              assert.calledThrice(spy);
              assert.matchingSentinels(spy.firstCall.args, chunks.slice(0, 1));
              assert.matchingSentinels(spy.secondCall.args, chunks.slice(1, 2));
              assert.matchingSentinels(spy.thirdCall.args, chunks.slice(2, 3));
            });
          });

          describe('if it returns a rejected promise', function() {
            it('emits an `error` event on the returned stream', function() {
              read.onFirstCall().returns({});

              var returned = instance._streamResults(1, function() {
                return Promise.rejected(sentinels.foo);
              }, returnTrue);

              var spy = sinon.spy();
              returned.stream.on('error', spy);

              return returned.toArray().otherwise(function() {
                assert.calledWithExactly(spy, sentinels.foo);
              });
            });

            it('causes consumption of the returned stream to fail', function() {
              read.onFirstCall().returns({});

              var returned = instance._streamResults(1, function() {
                return Promise.rejected(sentinels.foo);
              }, returnTrue);

              return assert.isRejected(returned.toArray(), sentinels.Sentinel);
            });
          });

          describe('if it throws', function() {
            it('emits an `error` event on the returned stream', function() {
              read.onFirstCall().returns({});

              var returned = instance._streamResults(1, function() {
                throw sentinels.foo;
              }, returnTrue);

              var spy = sinon.spy();
              returned.stream.on('error', spy);

              return returned.toArray().otherwise(function() {
                assert.calledWithExactly(spy, sentinels.foo);
              });
            });

            it('causes consumption of the returned stream to fail', function() {
              read.onFirstCall().returns({});

              var returned = instance._streamResults(1, function() {
                throw sentinels.foo;
              }, returnTrue);

              return assert.isRejected(returned.toArray(), sentinels.Sentinel);
            });
          });

          describe('each returned value', function() {
            describe('if not a promise', function() {
              it('is passed to `testResult`', function() {
                var chunks = sentinels.stubArray();
                var instance = new Streamist(new StreamArray(chunks.slice()));

                var spy = sinon.spy(returnTrue);
                var done = instance._streamResults(1, identity, spy).toArray();

                return done.then(function() {
                  assert.calledThrice(spy);
                  assert.matchingSentinels(spy.firstCall.args, [chunks[0]]);
                  assert.matchingSentinels(spy.secondCall.args, [chunks[1]]);
                  assert.matchingSentinels(spy.thirdCall.args, [chunks[2]]);
                });
              });
            });

            describe('if a thenable', function() {
              it('is passed to `testResult`, as-is', function() {
                var chunks = sentinels.stubArray();
                var instance = new Streamist(new StreamArray(chunks.slice()));

                var thenables = [];
                var iterator = function(chunk) {
                  var t = asThenable(chunk);
                  thenables.push(t);
                  return t;
                };

                var spy = sinon.spy(returnTrue);
                var done = instance._streamResults(
                  1, iterator, spy
                ).toArray();

                return done.then(function() {
                  assert.calledThrice(spy);
                  assert.strictEqual(spy.firstCall.args[0], thenables[0]);
                  assert.strictEqual(spy.secondCall.args[0], thenables[1]);
                  assert.strictEqual(spy.thirdCall.args[0], thenables[2]);
                });
              });
            });

            describe('if a promise', function() {
              it('is assimilated, with the fulfillment value passed to ' +
                '`testResult`',
                function() {
                  var chunks = sentinels.stubArray();
                  var instance = new Streamist(new StreamArray(chunks.slice()));

                  var spy = sinon.spy(returnTrue);
                  var done = instance._streamResults(
                    1, asPromise, spy).toArray();

                  return done.then(function() {
                    assert.calledThrice(spy);
                    assert.matchingSentinels(spy.firstCall.args, [chunks[0]]);
                    assert.matchingSentinels(spy.secondCall.args, [chunks[1]]);
                    assert.matchingSentinels(spy.thirdCall.args, [chunks[2]]);
                  });
                });
            });
          });
        });

        describe('causes `testResult` to be called', function() {
          describe('the return value controls how the corresponding ' +
            'iteration result is streamed',
            function() {
              var chunks, instance, testResult;
              beforeEach(function() {
                chunks = sentinels.stubArray();
                instance = new Streamist(new StreamArray(chunks.slice()));
                testResult = function(chunk) {
                  return chunk !== chunks[1];
                };
              });

              describe('when truey and not `STREAM_CHUNK_INSTEAD`', function() {
                describe('and the result is not a promise', function() {
                  it('streams the result as-is', function() {
                    return assert.eventually.matchingSentinels(
                      instance._streamResults(
                        1, identity, testResult
                      ).toArray(),
                      [chunks[0], chunks[2]]);
                  });
                });

                describe('and the result is a thenable', function() {
                  it('streams the result as-is', function() {
                    var thenables = [];
                    var iterator = function(chunk) {
                      var t = asThenable(chunk);
                      thenables.push(t);
                      return t;
                    };
                    var testResult = function(t) {
                      return t !== thenables[1];
                    };

                    return instance._streamResults(
                      1, iterator, testResult
                    ).toArray().then(function(values) {
                      assert.strictEqual(values[0], thenables[0]);
                      assert.strictEqual(values[1], thenables[2]);
                    });
                  });
                });

                describe('and the result is a promise', function() {
                  it('streams the fulfillment value', function() {
                    return assert.eventually.matchingSentinels(
                      instance._streamResults(
                        1, asPromise, testResult
                      ).toArray(),
                      [chunks[0], chunks[2]]);
                  });
                });
              });

              describe('if `STREAM_CHUNK_INSTEAD`', function() {
                it('streams the original chunk', function() {
                  return assert.eventually.matchingSentinels(
                    instance._streamResults(1, function() {
                      return sentinels.foo;
                    }, function() {
                      return STREAM_CHUNK_INSTEAD;
                    }).toArray(),
                    chunks);
                });
              });
            });
        });

        describe('when the returned stream is cancelled', function() {
          it('also cancels consumption of the input stream', function() {
            var pending = new Promise(function() {});
            read.onFirstCall().returns(pending);

            // Make sure to start consumption.
            returned.toArray();

            setTimeout(function() {
              assert.calledOnce(read);

              // Now cancel it. `pending` should have been returned by the
              // iterator and therefore also be cancelled.
              returned.cancel();
            }, 10);

            return assert.isRejected(pending, CancellationError);
          });
        });
      });

      describe('when the returned stream applies backpressure', function() {
        it('stops reading from the input stream', function() {
          var iterator = sinon.stub().returnsArg(0);
          var returned = instance._streamResults(1, iterator, returnTrue, {
            objectMode: true,
            highWaterMark: 1
          });

          read.onFirstCall().returns(sentinels.foo);
          read.onSecondCall().returns(sentinels.bar);

          return returned.consume().then(function() {
            assert.calledOnce(iterator);

            return returned.consume();
          }).then(function() {
            assert.calledTwice(iterator);
          });
        });
      });

      describe('multiple iterations, some returning promises that fulfill ' +
        'out of order',
        function() {
          it('halts iteration when `maxConcurrent` results are pending',
            function() {
              var chunks = sentinels.stubArray(10);
              var instance = new Streamist(new StreamArray(chunks.slice()));

              var resolvers = [];
              var iterator = sinon.stub();

              // promise, chunk, chunk
              iterator.onCall(0).returns(
                new Promise(function(resolve) {
                  resolvers[0] = function() { resolve(chunks[0]); };
                })
              );
              iterator.onCall(1).returns(chunks[1]);
              iterator.onCall(2).returns(chunks[2]);

              // chunk, chunk, promise, promise, promise
              iterator.onCall(3).returns(chunks[3]);
              iterator.onCall(4).returns(chunks[4]);
              iterator.onCall(5).returns(
                new Promise(function(resolve) {
                  resolvers[5] = function() { resolve(chunks[5]); };
                })
              );
              iterator.onCall(6).returns(
                new Promise(function(resolve) {
                  resolvers[6] = function() { resolve(chunks[6]); };
                })
              );
              iterator.onCall(7).returns(
                new Promise(function(resolve) {
                  resolvers[7] = function() { resolve(chunks[7]); };
                })
              );

              // chunk, chunk
              iterator.onCall(8).returns(chunks[8]);
              iterator.onCall(9).returns(chunks[9]);

              var returned = instance._streamResults(3, iterator, returnTrue, {
                objectMode: true,
                highWaterMark: 10
              });

              var done = returned.toArray();

              return delay(10).then(function() {
                // First iterator returned a promise, so now the two chunks
                // are pending, and iteration has halted.
                assert.callCount(iterator, 3);

                // Resolve that promise, should be able to consume the five
                // next chunks, since only the 6th, 7th and 8th iterations
                // will return promises.
                resolvers[0]();
                return delay(10);
              }).then(function() {
                assert.callCount(iterator, 8);

                // Iteration has halted, there are three pending promises.
                // Resolving the 7th shouldn't alleviate the backpressure.
                resolvers[6]();
                return delay(10);
              }).then(function() {
                assert.callCount(iterator, 8);

                // Resolving the 6th however does, and makes two more iterations
                // available.
                resolvers[5]();
                return delay(10);
              }).then(function() {
                assert.callCount(iterator, 10);

                // There are two chunks blocked behind the 8th iteration
                // promise. Resolving it should finish the iteration
                // alltogether.
                resolvers[7]();
              }).yield(assert.eventually.matchingSentinels(done, chunks));
            });
        });
    });

  describe('#map(iterator, options)', function() {
    it('relies on `mapParallel()`', function() {
      var mp = sinon.stub(instance, 'mapParallel').returns(sentinels.foo);
      assert.matchingSentinels(
        instance.map(identity, sentinels.bar),
        sentinels.foo);
      assert.calledWithExactly(mp, 1, identity, sentinels.bar);
    });
  });

  describe('#mapParallel(maxConcurrent, iterator, options)', function() {
    var read;
    beforeEach(function() {
      read = sinon.stub(stream, 'read').returns(null);
    });

    it('relies on `_streamResults()`', function() {
      var sr = sinon.stub(instance, '_streamResults').returns(sentinels.foo);
      assert.matchingSentinels(
        instance.mapParallel(sentinels.bar, identity, sentinels.baz),
        sentinels.foo);
      assert.calledWithExactly(sr,
        sentinels.bar, identity, sinon.match.func, sentinels.baz);
    });

    describe('the values returned by `iterator`', function() {
      describe('the returned stream', function() {
        it('streams the values', function() {
          var values = sentinels.stubArray();
          values.forEach(function(_, n) {
            read.onCall(n).returns(n);
          });

          var done = instance.mapParallel(1, function(n) {
            if (n === 2) {
              stream.emitEnd();
            }
            return values[n];
          }).toArray();

          return assert.eventually.matchingSentinels(done, values);
        });
      });

      describe('if `null`', function() {
        describe('consumption of the returned stream', function() {
          it('fails', function() {
            read.onFirstCall().returns({});

            var done = instance.mapParallel(1, function() {
              return null;
            }).toArray();

            return assert.isRejected(done, TypeError).then(function() {
              return assert.isRejected(done,
                /^Cannot map to a null or undefined value\.$/);
            });
          });
        });
      });

      describe('if `undefined`', function() {
        describe('consumption of the returned stream', function() {
          it('fails', function() {
            read.onFirstCall().returns({});

            var done = instance.mapParallel(1, function() {
              return undefined;
            }).toArray();

            return assert.isRejected(done, TypeError).then(function() {
              return assert.isRejected(done,
                /^Cannot map to a null or undefined value\.$/);
            });
          });
        });
      });
    });
  });

  describe('#filter(iterator)', function() {
    it('relies on `filterParallel()`', function() {
      var fp = sinon.stub(instance, 'filterParallel').returns(sentinels.foo);
      assert.matchingSentinels(
        instance.filter(identity),
        sentinels.foo);
      assert.calledWithExactly(fp, 1, identity);
    });
  });

  describe('#filterParallel(maxConcurrent, iterator)', function() {
    var chunks;
    beforeEach(function() {
      chunks = sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    it('relies on `_streamResults()`', function() {
      var sr = sinon.stub(instance, '_streamResults').returns(sentinels.foo);
      assert.matchingSentinels(
        instance.filterParallel(sentinels.bar, identity),
        sentinels.foo);
      assert.calledWithExactly(sr,
        sentinels.bar, identity, sinon.match.func);
    });

    describe('the values returned by `iterator`', function() {
      describe('only if truey', function() {
        describe('the returned stream', function() {
          it('streams the corresponding chunks', function() {
            var done = instance.filterParallel(1, function(chunk) {
              return chunk !== chunks[1];
            }).toArray();

            return assert.eventually.matchingSentinels(
              done, [chunks[0], chunks[2]]);
          });
        });
      });
    });
  });

  describe('#filterOut(iterator)', function() {
    it('relies on `filterOutParallel()`', function() {
      var fp = sinon.stub(instance, 'filterOutParallel').returns(sentinels.foo);
      assert.matchingSentinels(
        instance.filterOut(identity),
        sentinels.foo);
      assert.calledWithExactly(fp, 1, identity);
    });
  });

  describe('#filterOutParallel(maxConcurrent, iterator)', function() {
    var chunks;
    beforeEach(function() {
      chunks = sentinels.stubArray();
      instance = new Streamist(new StreamArray(chunks.slice()));
    });

    it('relies on `_streamResults()`', function() {
      var sr = sinon.stub(instance, '_streamResults').returns(sentinels.foo);
      assert.matchingSentinels(
        instance.filterOutParallel(sentinels.bar, identity),
        sentinels.foo);
      assert.calledWithExactly(sr,
        sentinels.bar, identity, sinon.match.func);
    });

    describe('the values returned by `iterator`', function() {
      describe('only if falsey', function() {
        describe('the returned stream', function() {
          it('streams the corresponding chunks', function() {
            var done = instance.filterOutParallel(1, function(chunk) {
              return chunk === chunks[1];
            }).toArray();

            return assert.eventually.matchingSentinels(
              done, [chunks[0], chunks[2]]);
          });
        });
      });
    });
  });
});
