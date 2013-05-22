'use strict';

// npm
var _ = require('underscore');

var CardDelta = function(card, user, url, actions) {
    this.card = card;
    this.user = user;
    this.url = url;
    this.actions = actions || {};
    CardDelta.ACTIONS.forEach(function(type) {
        this.actions[type] = this.actions[type] || new CardDelta.Action(type);
    }.bind(this));
};
CardDelta.ACTIONS = [
    'list', 'close', 'member', 'label', 'checklist', 'comment'
];
_.extend(CardDelta.prototype, {
    isMergableWith: function(other) {
        return other instanceof CardDelta &&
                this.card.id == other.card.id && this.user == other.user;
    },
    merge: function(other) {
        var url = other.url || this.url;
        var actions = {};
        CardDelta.ACTIONS.forEach(function(type) {
            actions[type] = this.actions[type].merge(other.actions[type]);
        }.bind(this));
        return new CardDelta(other.card, other.user, url, actions);
    },
    format: function() {
        return [
            '@'+this.user,
            '[' + this.card.name + (this.url ? ' <'+this.url+'>' : '') + ']'
        ].concat(this.actionMessages()).join(' ');
    },
    isEmpty: function() {
        return this.actionMessages().length <= 0;
    },
    actionMessages: function() { // private
        return CardDelta.ACTIONS.reduce(function(r, type) {
            return r.concat(this.actions[type].format());
        }.bind(this), []);
    }
});
CardDelta.ACTIONS.forEach(function(type) {
    CardDelta.prototype[type] = function() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift(type);
        var action = CardDelta.Action.apply(null, args);
        this.actions[type] = this.actions[type].merge(action);
        return this;
    };
});
CardDelta.Action = function(type) {
    var args = Array.prototype.slice.call(arguments, 1);
    var klass = type.charAt(0).toUpperCase() + type.slice(1);
    return CardDelta.Action[klass].apply(null, args);
};
CardDelta.Action.List = function(name, oldName) {
    return {
        name: name,
        oldName: oldName,
        merge: function(other) {
            var undef;
            var name = other.name || this.name;
            var oldName = this.name ? this.oldName : other.oldName;
            if (name == oldName) name = oldName = undef;
            return new CardDelta.Action.List(name, oldName);
        },
        format: function() {
            var msg = [];
            if (this.oldName) msg.push(this.oldName);
            if (this.name) msg.push('->', this.name);
            return msg.length ? [ msg.join(' ') ] : [];
        }
    };
};
CardDelta.Action.Close = function(close) {
    return {
        close: close,
        merge: function(other) {
            if (typeof this.close == 'boolean') {
                return CardDelta.Action.Close(); // cancel
            } else {
                return CardDelta.Action.Close(other.close);
            }
        },
        format: function() {
            if (typeof this.close != 'boolean') return [];
            return [ this.close ? '-> archive' : ' -> unarchive' ];
        }
    };
};
CardDelta.Action.Member = function(add, remove) {
    return {
        add: add || [],
        remove: remove || [],
        merge: function(other) {
            var add = this.add.filter(function(x) {
                return other.remove.indexOf(x) < 0;
            }).concat(other.add.filter(function(x) {
                return this.remove.indexOf(x) < 0;
            }.bind(this)));
            var remove = this.remove.filter(function(x) {
                return other.add.indexOf(x) < 0;
            }).concat(other.remove.filter(function(x) {
                return this.add.indexOf(x) < 0;
            }.bind(this)));
            return CardDelta.Action.Member(add, remove);
        },
        format: function() {
            var add = function(x){ return '+@'+x; };
            var remove = function(x){ return '-@'+x; };
            return this.add.map(add).concat(this.remove.map(remove));
        }
    };
};
CardDelta.Action.Label = function(names) {
    return {
        labels: names || [],
        merge: function(other) {
            var labels = this.labels.concat(other.labels.filter(function(x) {
                return this.labels.indexOf(x) < 0;
            }.bind(this)));
            return CardDelta.Action.Label(labels);
        },
        format: function() {
            if (this.labels.length <= 0) return [];
            return this.labels.map(function(label){ return '#'+label; });
        }
    };
};
CardDelta.Action.Checklist = function(list, item) {
    var lists = {};
    if (typeof list == 'string') {
        lists[list] = { items: {} };
        if (item) {
            lists[list].items[item.name] = (item.state == 'complete');
        } else {
            lists[list].added = true;
        }
    } else {
        lists = list;
    }
    return {
        lists: lists || {},
        merge: function(other) {
            var newLists = {}, list;
            for (list in this.lists) {
                newLists[list] = { added: this.lists[list].added };
                newLists[list].items = _.clone(this.lists[list].items);
            }
            for (list in other.lists) {
                newLists[list] = newLists[list] || { items: {} };
                newLists[list].added = newLists[list].added || other.lists[list].added;
                newLists[list].items = newLists[list].items || {};
                var items = newLists[list].items;
                for (var item in other.lists[list].items) {
                    if (typeof items[item] == 'boolean') {
                        delete items[item]; // cancel
                    } else {
                        items[item] = other.lists[list].items[item];
                    }
                }
            }
            return CardDelta.Action.Checklist(newLists);
        },
        format: function() {
            var msgs = [];
            for (var list in this.lists) {
                var items = this.lists[list].items;
                var checks = Object.keys(items).map(function(item) {
                    return '['+(items[item] ? 'x' : ' ')+']'+item;
                });
                if (checks.length > 0 || this.lists[list].added) {
                    msgs.push('('+(this.lists[list].added ? '+' : '')+list+')');
                    msgs = msgs.concat(checks);
                }
            }
            return msgs;
        }
    };
};
CardDelta.Action.Comment = function(text) {
    text = text || [];
    if (!Array.isArray(text)) text = [ text ];
    function truncate(text) {
        var len = 30;
        var e = '...';
        text = text.replace(/\s+/, '');
        return text.length > len ? text.substring(0, len-e.length)+e : text;
    }
    return {
        texts: text,
        merge: function(other) {
            return CardDelta.Action.Comment(this.texts.concat(other.texts));
        },
        format: function() {
            return this.texts.map(function(text) {
                return '"'+truncate(text)+'"';
            });
        }
    };
};

module.exports = CardDelta;
