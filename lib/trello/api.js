'use strict';

var request = require('../request.js');

// npm
var _ = require('underscore');
var Q = require('q');

var API = function (key, token) {
    this.key = key;
    this.token = token;
};
_.extend(API.prototype, {
    request: function (opts) { // private
        opts.url = 'https://api.trello.com/1' + opts.url;
        opts.qs = opts.qs || { };
        opts.qs.key = this.key;
        opts.qs.token = this.token;
        return request(opts).then(function () {
            return JSON.parse(arguments[0][1]);
        });
    },
    getBoard: function (id) {
        // <https://trello.com/docs/api/board/index.html#get-1-boards-board-id>
        return this.request({
            url: '/boards/' + id,
            qs: {
                members: 'all'
            }
        });
    }
});

module.exports = API;
