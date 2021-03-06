'use strict';

const moment = require('moment');
const _ = require('lodash');
const eventManager = require('../events/event-manager');
const config = require('config');
const Sequelize = require('sequelize');
const assert = require('assert');
const CronJob = require('node-cron').schedule;

let gTrends = null;

const trendEvent = eventManager.getTrendEvent('jubi');
trendEvent.on(data => {
  gTrends = data;
});

const mysql = config.storage.mysql;
const dbConn = new Sequelize(mysql.database, mysql.username, mysql.password, mysql.options);
const OrderModel = Sequelize.models.JubiOrders;

async function aggregate(type, data) {
  if (type == 'tick') {
    const result = [];
    for (let row of data) {
      result.push(_proccess(row));
    }
    return result;
  } else if (type == 'order-amount-by-price') {
    return await _getAmountByPrice(data); 
  } else if (type == 'order-biggest-amount-percent') {
    return await _getBiggestAmountOrders(data.coin, data.hours, data.percent);
  } else if (type == 'bars-within-hours') {
    return await _getBarsWithInXHours(data.coin, data.hours)
  }
}

_getAmountByPrice('mryc');

module.exports = aggregate;

function _proccess(row) {
  let result = _.pick(row, ['name', 'high', 'low', 'last', 'buy', 'sell']);
  result['时刻'] = moment(row.timestamp).format('hh:mm:ss');
  result['24H量'] = row.amount.toLocaleString();
  result['24H额'] = row.volume.toLocaleString();
  result['N价格位置'] = _normalizePricePosition(row.high, row.low, row.last);
  result['N价格方差'] = _normalizeHighLowSquareError(result['N价格位置']);
  result['买卖差%'] = _diffBetweenBuySell(row.buy, row.sell);

  const trend = _.get(gTrends, result.name);
  if (trend) {
    result['日涨跌%'] = ((result.last - trend.yprice) / trend.yprice * 100).toFixed(2);

    const thresholds = {
      '20%涨幅距今(天)': 1.2,
      '10%涨幅距今(天)': 1.1
    };

    let waveDate = _lastWaveSinceNow(trend, thresholds);

    for (let name in thresholds) {
      result[name] = waveDate[name];
    }

  }

  result = _.omit(result, ['high', 'low']);
  return result;
}

//归一化价格位置%,距离24H低位的位置
function _normalizePricePosition(high, low, x) {
  const range = high - low;
  const pos = (x - low) / (high - low);
  return pos.toFixed(3);
}
//归一化价格方差 [0.5, 1],越低越好
function _normalizeHighLowSquareError(nPos) {
  const val = Math.pow(1 - nPos, 2) + Math.pow(nPos, 2);
  return +val.toFixed(3);
}
//买一卖一价格差百分比
function _diffBetweenBuySell(buy, sell) {
  const val = (sell - buy) / buy * 100;
  return val.toFixed(3) + '%';
}

//最近一次日涨幅超过20%距今小时
function _lastWaveSinceNow(trend, thresholds) {
  const list = trend.data;
  let barList = [];
  let dayBar = null;
  let currDate = null;
  //将3小时bar聚合成日bar
  for (let trend of list) {
    let price = trend[1];
    let time = trend[0];
    let date = moment(time * 1000);
    if (!currDate || date.diff(currDate, 'days') >= 1) {
      if (dayBar) {
        barList.push(dayBar);
      }
      currDate = date.startOf('date');
      dayBar = {
        high: price,
        low: price,
        date: currDate
      };
    } else {
      if (price > dayBar.high)
        dayBar.high = price;
      if (price < dayBar.low)
        dayBar.low = price;
    }
  }

  if (dayBar) {
    barList.push(dayBar);
  }

  barList = _.sortBy(barList, bar => -bar.date.valueOf());
  
  const result = {};
  for (let name in thresholds) {
    result[name] = '> 3';
    let threshold = thresholds[name];

    for (let bar of barList) {
      if (bar.high / bar.low >= threshold) {
        result[name] = ((Date.now() - bar.date.valueOf()) / 86400000).toFixed(1);
        break;
      }
    }
  }

  return result;
}

//获取指定时间内最大的成交订单
async function _getBiggestAmountOrders(coin, hours = 24, percent = 0.3) {
  assert(coin, 'no coin');
  const start = moment().subtract(hours, 'hours').valueOf();
  const end = moment().valueOf();
  const result = await dbConn.query(
    `select count(1) as count from ${OrderModel.getTableName()}
    where name = :name and timestamp < :end and timestamp > :start`, {
      replacements: {
        name: coin,
        start,
        end
      }
    }
  );

  const limit = parseInt(percent * result[0][0].count);
  let rows = await dbConn.query(
    `select * from ${OrderModel.getTableName()}
    where name = :name and timestamp < :end and timestamp > :start
    order by amount desc
    limit :limit`, {
      model: OrderModel, 
      replacements: {
        name: coin,
        start,
        end,
        limit
      }
    }
  );

  _.forEach(rows, r => {
    r.price = parseFloat(r.price),
    r.amount = parseFloat(r.amount)
  });

  return _.reverse(rows);
}

//获取指定时间内价格量
async function _getAmountByPrice(data) {
  const coin = data.coin;
  const hours = parseInt(data.hours) || 72;
  const sql = 
  `select name, price, sum(amount) as amount, count(1) as count, type from ${OrderModel.getTableName()} 
  where name = :name and timestamp < :end and timestamp > :start 
  group by price, type
  order by price desc`;
  let rows = await dbConn.query(sql, { 
    model: OrderModel, 
    replacements: {
      name: coin,
      start: moment().subtract(hours, 'hours').valueOf(),
      end: moment().valueOf(),
    }
  });

  let sum = 0;
  let buySum = 0;
  let sellSum = 0;
  for (let row of rows) {
    row.amount = parseFloat(row.amount);
    row.price = parseFloat(row.price);
    sum += row.amount;
    if (row.type == 'buy')
      buySum += row.amount;
    else
      sellSum += row.amount;
  }

  const avg = sum / rows.length;
  const list = _.orderBy(_.filter(rows, r => r.amount >= avg), 'amount', 'asc');
  const buyList = _.filter(rows, r => r.type == 'buy');
  const buyAvg = buySum / buyList.length;
  const sellList = _.filter(rows, r => r.type == 'sell');
  const sellAvg = sellSum / sellList.length;
  return {
    list,
    avg,
    buyList: _.orderBy(_.filter(buyList, r => r.amount >= buyAvg), 'amount', 'asc'),
    buyAvg,
    sellList: _.orderBy(_.filter(sellList, r => r.amount >= sellAvg), 'amount', 'asc'),
    sellAvg
  }
}

//获取X小时内,5分钟,10分钟,30分钟bar
async function _getBarsWithInXHours(coin, hours) {
  const end = moment().valueOf();
  const start = moment().subtract(hours, 'hours').valueOf();
  const sql = 
  `select * from ${OrderModel.getTableName()}
  where name = :name and timestamp < :end and timestamp > :start
  order by timestamp asc`;

  let rows = await dbConn.query(sql, {
    model: OrderModel,
    replacements: {
      name: coin,
      start,
      end
    }
  });

  const _5bars = {};
  const _10bars = {};
  const _30bars = {};
  let _5bar, _10bar, _30bar = null;

  for (let row of rows) {
    row.price = parseFloat(row.price);
    row.amount = parseFloat(row.amount);
    
    let slot = parseInt(row.timestamp / (5 * 60 * 1000));
    _5bar = _5bars[slot];
    if (!_5bar) {
      _5bar = {
        amount: row.amount,
        volume: row.price * row.amount,
        price: row.price,
        timestamp: row.timestamp
      }
      _5bars[slot] = _5bar;
    } else {
      _5bar.amount += row.amount;
      _5bar.volume += row.price * row.amount;
      _5bar.price = _5bar.volume / _5bar.amount;
    }

    slot = parseInt(row.timestamp / (10 * 60 * 1000));
    _10bar = _10bars[slot];
    if (!_10bar) {
      _10bar = {
        amount: row.amount,
        volume: row.price * row.amount,
        price: row.price,
        timestamp: row.timestamp
      }
      _10bars[slot] = _10bar;
    } else {
      _10bar.amount += row.amount;
      _10bar.volume += row.price * row.amount;
      _10bar.price = _10bar.volume / _10bar.amount;
    }

    slot = parseInt(row.timestamp / (30 * 60 * 1000));
    _30bar = _30bars[slot];
    if (!_30bar) {
      _30bar = {
        amount: row.amount,
        volume: row.price * row.amount,
        price: row.price,
        timestamp: row.timestamp
      }
      _30bars[slot] = _30bar;
    } else {
      _30bar.amount += row.amount;
      _30bar.volume += row.price * row.amount;
      _30bar.price = _30bar.volume / _30bar.amount;
    }
  }

  return {
    '5bars': _.values(_5bars),
    '10bars': _.values(_10bars),
    '30bars': _.values(_30bars),
  };
}