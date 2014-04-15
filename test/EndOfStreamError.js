'use strict';

var EndOfStreamError = require('../').EndOfStreamError;

describe('EndOfStreamError', function() {
  it('extends Error', function() {
    assert.instanceOf(new EndOfStreamError(), Error);
  });

  it('has the expected shape', function() {
    var err = new EndOfStreamError();
    assert.propertyVal(err, 'name', 'end-of-stream');
    assert.propertyVal(err, 'stack', null);
    assert.equal(err.message, '');
  });

  describe('EndOfStreamError#inspect()', function() {
    it('returns "[EndOfStreamError]"', function() {
      assert.equal(new EndOfStreamError().inspect(), '[EndOfStreamError]');
    });
  });
});
