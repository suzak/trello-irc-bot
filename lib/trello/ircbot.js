'use strict';

var TrelloStream = require('./stream.js');

// node
var util = require('util');

// npm
var _ = require('underscore');
var Q = require('q');
var IRCClient = require('irc').Client;


function eventToPromise (ee, event) {
    var deferred = Q.defer();
    ee.on(event, _.bind(deferred.resolve, deferred));
    return deferred.promise;
}

var Bot = function (config) {
    this.config = config;

    var irc = this.irc = new IRCClient(config.irc.host, config.irc.nick, {
        port: config.irc.port,
        password: config.irc.password
    });
    irc.on('motd', _.bind(this.onIRCConnect, this));

    var stream = this.stream = new TrelloStream(config.token);
    stream.on('connect', _.bind(this.onStreamConnect, this));
    stream.on('notify', _.bind(this.onStreamNotify, this));
    Q.allResolved([
        eventToPromise(irc, 'motd'),
        eventToPromise(stream, 'connect')
    ]).then(_.bind(this.dequeue, this));
    this.queue = [ ];
    this.channels = { };
};
_.extend(Bot.prototype, {
    onIRCConnect: function () {
        console.log('irc connected');
    },
    onStreamConnect: function () { // private
        this.config.subscription.map(_.bind(function (i) {
            var d = this.stream.subscribeToBoard(i.board);
            d.then(
                _.bind(this.onBoardSubscribed, this, i.board, i['irc.channel']),
                function (error) { console.warn(error); }
            );
        }, this));
    },
    onStreamNotify: function (data) { // private
        var channel = this.channels[data.idBoard];
        if (typeof channel !== 'undefined') {
            this.enqueue('notice', channel, JSON.stringify(data));
        }
    },
    onBoardSubscribed: function (board_id, channel, data) { // private
        this.enqueue('join', channel);
        this.channels[board_id] = channel;
        console.log(data);
    },
    enqueue: function () { // private
        this.queue.push(Array.prototype.slice.call(arguments));
    },
    dequeue: function () { // private
        var action = this.queue.shift();
        if (action) {
            var method = action.shift();
            this.irc[method].apply(this.irc, action);
        }
        Q.delay(1000).done(_.bind(this.dequeue, this));
    }
});

module.exports = Bot;
