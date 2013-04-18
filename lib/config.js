'use strict';

// node
var fs = require('fs');

function load (filename) {
    var json = fs.readFileSync(filename);
    var config = JSON.parse(json);
    return config;
}

module.exports = {
    load: load
};
