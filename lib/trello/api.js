'use strict';

// npm
var _ = require('underscore');
var Q = require('q');
var request = require('request');

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
        return Q.nfcall(request, opts).then(function () {
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
    },
    getCardShortURL: function (id) {
        // <https://trello.com/docs/api/card/index.html#get-1-cards-card-id-or-shortlink-field>
        return this.request({
            url: '/cards/' + id + '/shortUrl'
        }).then(function (data) {
            return data._value;
        });
    }
});

module.exports = API;
