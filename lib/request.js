'use strict';

// npm
var Q = require('q');
var request = require('request');

module.exports = function (options) {
    var deferred = Q.defer();
    request(options, function (err, res, body) {
        deferred.resolve(body);
    });
    return deferred.promise;
};
