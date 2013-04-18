'use strict';

var TrelloBot = require('./lib/trello/ircbot.js');


var config = require('./lib/config.js').load(process.env['CONFIG_FILE']);

var bot = new TrelloBot(config);
