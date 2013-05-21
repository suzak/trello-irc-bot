'use strict';

var TrelloAPI = require('./api.js');
var TrelloStream = require('./stream.js');
var CardDelta = require('./carddelta.js');

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

var Nop = function(){};

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
            function (error) { console.warn(error); }
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
        var delta = new CardDelta(data.card, member.username);
        var board = data.board;
        var setting = this.config.stream.subscriptions.board[id];
        switch (type) {
        case 'createCard':
            delta.list(data.list.name);
            break;
        case 'updateCard':
            console.log(data.old);
            switch (Object.keys(data.old)[0]) {
            case 'idList':
                delta.list(data.listAfter.name, data.listBefore.name);
                break;
            case 'closed':
                delta.close(data.card.closed);
                break;
            case 'pos':
                // ignore
                return;
            default:
                console.log(arguments);
                return;
            }
            break;
        case 'addChecklistToCard':
            delta.checklist(data.checklist.name);
            break;
        case 'updateCheckItemStateOnCard':
            delta.checklist(data.checklist.name, data.checkItem);
            break;
        case 'addLabelToCard':
            delta.label([ data.text ]);
            break;
        case 'addMemberToCard':
            delta.member([ this.members[data.idMember].username ]);
            break;
        case 'removeMemberFromCard':
            delta.member(null, [ this.members[data.idMember].username ]);
            break;
        case 'commentCard':
            delta.comment(data.text);
            break;
        default:
            console.log(arguments);
            return;
        }
        this.noticeWithCardShortUrl(delta, setting, data.card.id);
    },
    noticeWithCardShortUrl: function (delta, setting, card_id) { // private
        this.api.getCardShortURL(card_id)
            .then(function (url) { delta.url = url; })
            .done(this.notice.bind(this, delta, setting));
    },
    notice: function (content, setting) { // private
        this.enqueue({
            at: Date.now() + (setting.delay||30000),
            method: 'notice',
            get args() {
                var msg = this.content;
                if (typeof this.content != 'string' &&
                    typeof this.content.format == 'function') {
                    if (this.content.isEmpty()) throw new Nop();
                    msg = this.content.format();
                }
                return [
                    setting.channel,
                    new Iconv('utf-8', setting.charset).convert(msg).toString()
                ];
            },
            content: content
        });
    },
    merge: function() {
        this.queue = this.queue.reduce(function(r, action) {
            var last;
            if ((last = r[r.length-1]) && last.content && action.content &&
                last.content.isMergableWith &&
                last.content.isMergableWith(action.content)) {
                last.at = action.at;
                last.content = last.content.merge(action.content);
            } else {
                r.push(action);
            }
            return r;
        }, []);
    },
    enqueue: function (action) { // private
        this.queue.push(action);
        this.merge();
    },
    dequeue: function () { // private
        var action = this.queue[0];
        if (action && ( this.queue.length > 1 ||
                        !action.at || action.at <= Date.now() )) {
            this.queue.shift();
            try {
                this.irc[action.method].apply(this.irc, action.args);
            } catch (e) {
                if (!(e instanceof Nop)) throw e; // rethrow
            }
        }
        Q.delay(1000).done(this.dequeue.bind(this));
    }
});

module.exports = Bot;
