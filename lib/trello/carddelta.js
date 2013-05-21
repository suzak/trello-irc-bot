'use strict';

// npm
var _ = require('underscore');

var CardDelta = function(card, user, url, actions) {
    var self = this;
    this.card = card;
    this.user = user;
    this.actions = actions || {};
    CardDelta.ACTIONS.forEach(function(type) {
        self.actions[type] = self.actions[type] || new CardDelta.Action(type);
    });
};
CardDelta.ACTIONS = [
    'list', 'close', 'member', 'label', 'checklist', 'comment'
];
_.extend(CardDelta.prototype, {
    isMergableWith: function(other) {
        return this.card.id == other.card.id && this.user == other.user;
    },
    merge: function(other) {
        var self = this;
        var url = other.url || this.url;
        var actions = {};
        CardDelta.ACTIONS.forEach(function(type) {
            actions[type] = self.actions[type].merge(other.actions[type]);
        });
        return new CardDelta(other.card, other.user, url, actions);
    },
    format: function() {
        return [
            '@'+this.user,
            '[' + this.card.name + (this.url ? ' <'+this.url+'>' : '') + ']',
            this.actionMessages().join(', ')
        ].join(' ');
    },
    isEmpty: function() {
        return this.actionMessages().length <= 0;
    },
    actionMessages: function() { // private
        var self = this;
        return CardDelta.ACTIONS.reduce(function(r, type) {
            return r.concat(self.actions[type].format());
        }, []);
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
            var name = other.name;
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
            return [ this.close ? 'archive' : 'unarchive' ];
        }
    };
};
CardDelta.Action.Member = function(add, remove) {
    return {
        add: add || [],
        remove: remove || [],
        merge: function(other) {
            var self = this;
            var add = this.add.filter(function(x) {
                return other.remove.indexOf(x) < 0;
            }).concat(other.add.filter(function(x) {
                return self.remove.indexOf(x) < 0;
            }));
            var remove = this.remove.filter(function(x) {
                return other.add.indexOf(x) < 0;
            }).concat(other.remove.filter(function(x) {
                return self.add.indexOf(x) < 0;
            }));
            return CardDelta.Action.Member(add, remove);
        },
        format: function() {
            var add = function(x){ return '+@'+x; };
            var remove = function(x){ return '-@'+x; };
            var msgs = this.add.map(add).concat(this.remove.map(remove));
            if (msgs.length <= 0) return [];
            return [ 'member: ' + msgs.join(', ') ];
        }
    };
};
CardDelta.Action.Label = function(names) {
    return {
        labels: names || [],
        merge: function(other) {
            var self = this;
            var labels = this.labels.concat(other.labels.filter(function(x) {
                return self.labels.indexOf(x) < 0;
            }));
            return CardDelta.Action.Label(labels);
        },
        format: function() {
            if (this.labels.length <= 0) return [];
            return [ 'label: ' + this.labels.join(', ') ];
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
            var self = this;
            for (var list in this.lists) {
                var items = this.lists[list].items;
                var checks = Object.keys(items).map(function(item) {
                    return '['+(items[item] ? 'x' : ' ')+']'+item;
                });
                if (checks.length > 0 || this.lists[list].added) {
                    msgs.push([
                        '('+(this.lists[list].added ? '+' : '')+list+')',
                        checks.join(', ')
                    ].join(' '));
                }
            }
            return msgs;
        }
    };
};
CardDelta.Action.Comment = function(text) {
    text = text || [];
    if (!Array.isArray(text)) text = [ text ];
    return {
        texts: text,
        merge: function(other) {
            return CardDelta.Action.Comment(this.texts.concat(other.texts));
        },
        format: function() {
            return this.texts.map(function(text) {
                return 'comment: ' +text.replace(/\s+/, '').substring(0, 20);
            });
        }
    };
};

module.exports = CardDelta;
