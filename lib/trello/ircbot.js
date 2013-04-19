'use strict';

var TrelloAPI = require('./api.js');
var TrelloStream = require('./stream.js');

// npm
var _ = require('underscore');
var Q = require('q');
var Iconv = require('iconv').Iconv;
var IRCClient = require('irc').Client;


function eventToPromise (ee, event) {
    var deferred = Q.defer();
    ee.once(event, deferred.resolve.bind(deferred));
    return deferred.promise;
}

var Bot = function (config) {
    this.config = config;
    this.queue = [ ];
    this.board_settings = { };
    this.boards = { };
    this.members = { };
    this.api = new TrelloAPI(config.application.key, config.application.token);

    var irc = this.irc = new IRCClient(config.irc.host, config.irc.nick, {
        port: config.irc.port,
        password: config.irc.password
    });
    irc.on('motd', this.onIRCConnect.bind(this));
    irc.on('disconnect', this.onIRCDisconnect.bind(this));

    var stream = this.stream = new TrelloStream(config.stream.token);
    stream.on('connect', this.onStreamConnect.bind(this));
    stream.on('notify', this.onStreamNotify.bind(this));

    Q.allResolved([
        eventToPromise(irc, 'motd'),
        eventToPromise(stream, 'connect')
    ]).then(this.dequeue.bind(this));
};
_.extend(Bot.prototype, {
    onIRCConnect: function () { // private
        console.log('irc connected');
    },
    onIRCDisconnect: function () { //private
        console.log('irc Disconnected');
    },
    onStreamConnect: function () { // private
        Object.keys(this.config.stream.subscriptions.board).map((function (k) {
            var i = this.config.stream.subscriptions.board[k];
            this.stream.subscribeToBoard(k).then(
                this.onBoardSubscribed.bind(this, k, i),
                function (error) { console.warn(error) }
            );
        }).bind(this));
    },
    onStreamNotify: function (data) { // private
        switch (data.typeName) {
        case 'Action':
            data.deltas.map((function (i) {
                console.log(data.deltas);
                var member = this.members[i.idMemberCreator];
                this.onAction(i.type, member, i.data);
            }).bind(this));
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
    onBoardSubscribed: function (board_id, setting, data) { // private
        this.enqueue('join', setting.channel);
        this.board_settings[board_id] = setting;
        this.api.getBoard(board_id).then((function (board) {
            board.members.map((function (i) {
                this.members[i.id] = i;
            }).bind(this));
            delete board.members;
            this.boards[board_id] = board;
        }).bind(this));
    },
    onAction: function (type, member, data) { // private
        var board = data.board;
        var setting = this.board_settings[board.id];
        if (typeof setting === 'undefined') {
            return;
        }
        var message = [member.username + ':'];
        switch (type) {
        case 'createCard':
            message.push('カード', data.card.name, 'を',
                         data.list.name, 'に登録しました');
            this.notice(message.join(' '), setting);
            break;
        case 'updateCard':
            if (typeof data.listBefore !== 'undefined'
                    && typeof data.listAfter !== 'undefined') {
                message.push('カード', data.card.name, 'を',
                             data.listBefore.name, 'から',
                             data.listAfter.name, 'に移動しました');
                this.notice(message.join(' '), setting);
            }
            break;
        case 'updateCheckitemStateOnCard':
            message.push('カード', data.card.name, 'の',
                         data.checklist.name, 'の', data.checkItem.name,
                         (data.checkItem.state === 'complete' ?
                              'を完了しました' : 'を未完了に戻しました'));
            this.notice(message.join(' '), setting);
            break;
        default:
            console.log(arguments);
        }
    },
    notice: function (message, setting) { // private
        if (typeof setting.charset !== 'undefined' && setting.charset !== 'utf-8') {
            var iconv = new Iconv('utf-8', setting.charset);
            message = iconv.convert(message).toString();
        }
        this.enqueue('notice', setting.channel, message);
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
        Q.delay(1000).done(this.dequeue.bind(this));
    }
});

module.exports = Bot;
