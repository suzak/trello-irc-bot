'use strict';

var TrelloAPI = require('./api.js');
var TrelloStream = require('./stream.js');

// npm
var _ = require('underscore');
var Q = require('q');
var IRCClient = require('irc').Client;


function eventToPromise (ee, event) {
    var deferred = Q.defer();
    ee.once(event, _.bind(deferred.resolve, deferred));
    return deferred.promise;
}

var Bot = function (config) {
    this.config = config;
    this.queue = [ ];
    this.channels = { };
    this.boards = { };
    this.members = { };
    this.api = new TrelloAPI(config.application.key, config.application.token);

    var irc = this.irc = new IRCClient(config.irc.host, config.irc.nick, {
        port: config.irc.port,
        password: config.irc.password
    });
    irc.on('motd', _.bind(this.onIRCConnect, this));

    var stream = this.stream = new TrelloStream(config['stream.token']);
    stream.on('connect', _.bind(this.onStreamConnect, this));
    stream.on('notify', _.bind(this.onStreamNotify, this));

    Q.allResolved([
        eventToPromise(irc, 'motd'),
        eventToPromise(stream, 'connect')
    ]).then(_.bind(this.dequeue, this));
};
_.extend(Bot.prototype, {
    onIRCConnect: function () { // private
        console.log('irc connected');
    },
    onStreamConnect: function () { // private
        this.config.subscriptions.map(_.bind(function (i) {
            this.stream.subscribeToBoard(i.board).then(
                _.bind(this.onBoardSubscribed, this, i.board, i['irc.channel']),
                function (error) { console.warn(error); }
            );
        }, this));
    },
    onStreamNotify: function (data) { // private
        switch (data.typeName) {
        case 'Action':
            data.deltas.map(_.bind(function (i) {
                console.log(data.deltas);
                var member = this.members[i.idMemberCreator];
                this.onAction(i.type, member, i.data);
            }, this));
            break;
        case 'Member':
        case 'Checklist':
        case 'Card':
            // ignore
            break;
        default:
            console.log('unknown typeName `' + data.typeName + '`: ' + JSON.stringify(data));
        }
    },
    onBoardSubscribed: function (board_id, channel, data) { // private
        this.enqueue('join', channel);
        this.channels[board_id] = channel;
        this.api.getBoard(board_id).then(_.bind(function (board) {
            board.members.map(_.bind(function (i) {
                this.members[i.id] = i;
            }, this));
            delete board.members;
            this.boards[board_id] = board;
        }, this));
    },
    onAction: function (type, member, data) { // private
        var board = data.board;
        var channel = this.channels[board.id];
        if (typeof channel === 'undefined') {
            return;
        }
        var message = [member.username + ':'];
        switch (type) {
        case 'createCard':
            message.push('カード', data.card.name, 'を',
                         data.list.name, 'に登録しました');
            this.enqueue('notice', channel, message.join(' '));
            break;
        case 'updateCard':
            if (typeof data.listBefore !== 'undefined'
                    && typeof data.listAfter !== 'undefined') {
                message.push('カード', data.card.name, 'を',
                             data.listBefore.name, 'から',
                             data.listAfter.name, 'に移動しました');
                this.enqueue('notice', channel, message.join(' '));
            }
            break;
        case 'updateCheckitemStateOnCard':
            message.push('カード', data.card.name, 'の',
                         data.checklist.name, 'の', data.checkItem.name,
                         (data.checkItem.state === 'complete' ?
                              'を完了しました' : 'を未完了に戻しました'));
            this.enqueue('notice', channel, message.join(' '));
            break;
        default:
        }
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
