'use strict';

var UnreadableStreamError = require('../').UnreadableStreamError;

describe('UnreadableStreamError', function() {
  it('extends Error', function() {
    assert.instanceOf(new UnreadableStreamError(), Error);
  });

  it('has the expected shape', function() {
    var err = new UnreadableStreamError();
    assert.propertyVal(err, 'name', 'unreadable-stream');
    assert.propertyVal(err, 'stack', null);
    assert.equal(err.message, '');
  });

  describe('UnreadableStreamError#inspect()', function() {
    it('returns "[UnreadableStreamError]"', function() {
      assert.equal(
        new UnreadableStreamError().inspect(), '[UnreadableStreamError]');
    });
  });
});
