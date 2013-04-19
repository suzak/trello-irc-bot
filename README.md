trello-irc-bot
==============

trello の更新情報を IRC に流す bot です.

trello のウェブインタフェイスで利用されている WebSocket (`socket.io`) を利用して
リアルタイムに trello の更新情報を IRC でしゃべります.

使い方
------

`config/config.json.in` を参考に `config/{xxx}.json` をつくって

    $ npm install
    $ CONFIG_FILE=config/{xxx}.json npm start

とします.

trello の WebSocket と API では, 用いる `token` が異なるため,
2つの `token` が必要であることに注意してください.

注意事項
--------

* 購読するボードごとに 1 本 WebSocket 接続します
  * 1 本の WebSocket 接続で複数のボードを購読できないためです
* `{"trellisVersion":"0.10.611","version":"0.10.611","versionMin":"0.10.597"}`
  の頃に作成しました.  trello が新しくなって動かなくなったら解析して直してください.
