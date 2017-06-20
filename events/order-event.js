'use strict';

const Event = require('events');

class OrderEvent extends Event {
  constructor(coin) {
    super();
    this.coin = coin;
  }

  emit(data) {
    super.emit(this.coin, data);
  }

  on(cb) {
    super.on(this.coin, cb);
  }
}

module.exports = OrderEvent;