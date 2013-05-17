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
    this.boards = { };
    this.members = { };
    this.irc = null;
    this.streams = { };

    this.api = new TrelloAPI(config.application.key, config.application.token);

    this.connect();
};
_.extend(Bot.prototype, {
    connect: function () {
        var config = this.config;
        var irc = this.irc = new IRCClient(config.irc.host, config.irc.nick, {
            port: config.irc.port,
            password: config.irc.password
        });
        irc.on('motd', this.onIRCConnect.bind(this));
        irc.on('disconnect', this.onIRCDisconnect.bind(this));
        var promises = [eventToPromise(irc, 'motd')];

        Object.keys(config.stream.subscriptions.board).map((function (id) {
            var stream = new TrelloStream(config.stream.token);
            this.streams[id] = stream;
            stream.on('connect', this.onStreamConnect.bind(this, id));
            stream.on('notify', this.onStreamNotify.bind(this, id));
            promises.push(eventToPromise(stream, 'connect'));
        }).bind(this));

        Q.allResolved(promises).then(this.dequeue.bind(this));
    },
    disconnect: function () {
        this.irc.disconnect('bye');
        Object.keys(this.streams).map((function (i) {
            this.streams[i].disconnect();
        }).bind(this));
    },
    onIRCConnect: function () { // private
        console.log('irc connected');
    },
    onIRCDisconnect: function () { //private
        console.log('irc disconnected');
    },
    onStreamConnect: function (id) { // private
        this.streams[id].subscribeToBoard(id).then(
            this.onBoardSubscribed.bind(this, id),
            function (error) { console.warn(error) }
        );
    },
    onStreamNotify: function (id, data) { // private
        switch (data.event) {
        case 'updateModels':
            this.onUpdateModels(id, data.typeName, data.deltas);
            break;
        case 'deleteModels':
            this.onDeleteModels(id, data.typeName, data.deltas);
            break;
        default:
            console.log('unknown event `' + data.event + '`: ' + JSON.stringify(data));
        }
    },
    onBoardSubscribed: function (id, data) { // private
        var setting = this.config.stream.subscriptions.board[id];
        this.enqueue({ method: 'join', args: [ setting.channel ] });
        this.api.getBoard(id).then((function (board) {
            board.members.map((function (i) {
                this.members[i.id] = i;
            }).bind(this));
            delete board.members;
            this.boards[id] = board;
        }).bind(this));
    },
    onUpdateModels: function (id, type, deltas) { // private
        switch (type) {
        case 'Action':
            deltas.map((function (i) {
                var member = this.members[i.idMemberCreator];
                this.onAction(id, i.type, member, i.data);
            }).bind(this));
            break;
        case 'Member':
        case 'Checklist':
        case 'Card':
        case 'Board':
            // ignore
            break;
        default:
            console.log('unknown typeName `' + type + '`: ' + JSON.stringify(deltas));
        }
    },
    onDeleteModels: function (id, type, deltas) { // private
        // ignore
    },
    onAction: function (id, type, member, data) { // private
        var board = data.board;
        var setting = this.config.stream.subscriptions.board[id];
        var message = ['@' + member.username, data.card.name];
        switch (type) {
        case 'createCard':
            message.push('-> ' + data.list.name);
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        case 'updateCard':
            console.log(data.old);
            switch (Object.keys(data.old)[0]) {
            case 'idList':
                message.push(data.listBefore.name + ' -> ' + data.listAfter.name);
                break;
            case 'closed':
                message.push(data.card.closed ? 'archive' : 'unarchive');
                break;
            case 'pos':
                // ignore
                break;
            default:
                console.log(arguments);
            }
            if (message.length > 2) {
                this.noticeWithCardShortUrl(message, setting, data.card.id);
            }
            break;
        case 'addChecklistToCard':
            message.push('checklist: +' + data.checklist.name);
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        case 'updateCheckItemStateOnCard':
            message.push((data.checkItem.state === 'complete' ?  '[x]' : '[ ]')+
                         data.checkItem.name +
                         ( data.checklist.name == 'Checklist' ?
                           '' : '(' + data.checklist.name + ')' ));
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        case 'addLabelToCard':
            message.push('label: +' + data.text);
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        case 'addMemberToCard':
            var newMember = this.members[data.idMember];
            message.push('member: +@' + newMember.username);
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        case 'removeMemberFromCard':
            var removedMember = this.members[data.idMember];
            message.push('member: -@' + removedMember.username);
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        case 'commentCard':
            message.push('comment: ' + data.text.replace(/\s+/, '').substring(0, 20));
            this.noticeWithCardShortUrl(message, setting, data.card.id);
            break;
        default:
            console.log(arguments);
        }
    },
    formatCardMessage: function(message, setting) { // private
        message = [
            message[0] + ' ['+message[1]+']'
        ].concat(message.slice(2)).join(" ");
        if (typeof setting.charset !== 'undefined' && setting.charset !== 'utf-8') {
            var iconv = new Iconv('utf-8', setting.charset);
            message = iconv.convert(message).toString();
        }
        return message;
    },
    noticeWithCardShortUrl: function (message, setting, card_id) { // private
        this.api.getCardShortURL(card_id)
            .then(function (url) { message[1] += '<' + url + '>'; })
            .done(this.notice.bind(this, {
                message: message,
                formatter: this.formatCardMessage.bind(this),
                mergeBy: card_id,
                merge: [ null, null, function(a, b){ return a+', '+b; } ]
            }, setting));
    },
    notice: function (content, setting) { // private
        this.enqueue({
            at: Date.now() + (setting.delay||30000),
            method: 'notice',
            get args() {
                return [
                    setting.channel,
                    this.content.formatter(content.message, setting)
                ];
            },
            content: content
        });
    },
    mergeMessage: function() {
        this.queue = this.queue.reduce(function(r, action) {
            var last;
            var merge = function(x, y){ return y; }; // default merge is snd
            if ((last = r[r.length-1]) && last.content && action.content &&
                last.content.message && action.content.message &&
                last.content.mergeBy == action.content.mergeBy) {
                var message = action.content.message;
                last.at = action.at;
                last.content.message = message.map(function(msg, i) {
                    var msf = last.content.message[i] || '';
                    return ((action.content.merge||[])[i] || merge)(msf, msg);
                });
            } else {
                r.push(action);
            }
            return r;
        }, []);
    },
    enqueue: function (action) { // private
        this.queue.push(action);
        this.mergeMessage();
    },
    dequeue: function () { // private
        var action = this.queue[0];
        if (action && ( this.queue.length > 1 ||
                        !action.at || action.at <= Date.now() )) {
            this.queue.shift();
            this.irc[action.method].apply(this.irc, action.args);
        }
        Q.delay(1000).done(this.dequeue.bind(this));
    }
});

module.exports = Bot;
