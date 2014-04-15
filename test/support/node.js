'use strict';

var chai = require('chai');
var sinon = require('sinon');
var sentinels = require('chai-sentinels');

var stubs = require('./stubs');

chai.use(sentinels);
chai.use(require('chai-as-promised'));

sinon.assert.expose(chai.assert, { prefix: '' });

global.assert = chai.assert;
global.sentinels = sentinels;
global.stubs = stubs;
