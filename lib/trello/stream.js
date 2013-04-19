'use strict';

var request = require('../request.js');

// node
var EventEmitter = require('events').EventEmitter;
var util = require('util');

// npm
var _ = require('underscore');
var Q = require('q');
var WebSocket = require('ws');


var Stream = function (token) {
    this.reqid = 0;
    this.token = token;
    this.callbacks = { };
    this.reconnect = true;

    EventEmitter.call(this);

    this.connect();
};
util.inherits(Stream, EventEmitter);
_.extend(Stream.prototype, {
    connect: function () {
        if (this.ws) {
            return;
        }
        var promise = request({
            url: 'https://trello.com/socket.io/1/',
            qs: { t: new Date }
        });
        promise.then((function () {
            var body = arguments[0][1];
            this.openWebSocket(body.split(':')[0]);
        }).bind(this));
    },
    disconnect: function () {
        this.reconnect = false;
        if (this.ws) {
            this.ws.close();
            delete this.ws;
        }
    },
    openWebSocket: function (id) { // private
        var ws = this.ws = new WebSocket('wss://trello.com/socket.io/1/websocket/' + id);
        ws.on('open', this.onOpen.bind(this));
        ws.on('close', this.onClose.bind(this));
        ws.on('message', this.onMessage.bind(this));
    },
    onOpen: function () { // private
        this.emit('opend');
    },
    onClose: function () { // private
        this.emit('closed');
        delete this.ws;
        if (this.reconnect) {
            this.connect();
        }
    },
    // socket.io-client parser.js
    messageRegexp: /([^:]+):([0-9]+)?(\+)?:([^:]+)?:?([\s\S]*)?/,
    onMessage: function (message, flags) { // private
        console.log('>> ' + message);
        var data = message.match(this.messageRegexp);
        data[1] = +data[1];
        if (data[5]) {
            data[5] = JSON.parse(data[5]);
        }
        if (data[1] == 1) {
            var pinged = this.ping();
            pinged.then(this.emit.bind(this, 'connect'));
        } else if (data[1] == 2) {
            this.send(2);
        } else if (data[1] == 4) {
            var notify = data[5].notify;
            var reqid = data[5].reqid;
            if (typeof notify !== 'undefined') {
                this.emit('notify', notify);
            } else if (typeof reqid !== 'undefined') {
                var callback = this.callbacks[reqid];
                if (callback) {
                    callback(data[5].error, data[5].result);
                    delete this.callbacks[reqid];
                }
            }
        }
    },
    send: function (n, obj) { // private
        var message = [n, '', ''];
        if (obj) {
            message.push(JSON.stringify(obj));
        }
        console.log('<< ' + message.join(':'));
        this.ws.send(message.join(':'));
    },
    request: function (fn, args) {
        var reqid = this.reqid++;
        this.send(3, {
            'sFxn': fn,
            'rgarg': args || [],
            'reqid': reqid,
            'token': this.token
        });
        var deferred = Q.defer();
        this.callbacks[reqid] = deferred.makeNodeResolver();
        return deferred.promise;
    },
    ping: function () {
        return this.request('ping', []);
    },
    subscribeToBoard: function (board) {
        return this.request('subscribeToBoard', [board, []]);
    }
});

module.exports = Stream;
