'use strict';

const request = require('request-promise');
const config = require('config');
const qs = require('querystring');
const crypto = require('crypto');

const key = config.market.jubi.key;
const secret = config.market.jubi.secret;
const apiServer = config.market.jubi.apiServer;
const webServer = config.market.jubi.webServer;

function _sign(params) {
  params.nonce = Date.now();
  params.key = key;

  const toSignStr = qs.stringify(params);
  params.signature = crypto.createHmac('sha256', secret).update(toSignStr).digest('hex');
  return params;
}

async function getTicker(coin) {
  const params = { coin };
  _sign(params);

  return await request(apiServer + 'ticker', { method: 'post', body: params, json: true });
}

async function getDepth(coin) {
  const params = { coin };
  _sign(params);

  return await request(apiServer + 'depth', { method: 'post', body: params, json: true });
}

async function getDepthByWeb(coin) {
  const url = `${webServer}coin/${coin}/trades`;
  const data = await request(url, { json: true });
  return {
    asks: data.buy,
    bids: data.sell
  };
}

async function getOrders(coin) {
  const params = { coin };
  _sign(params);

  return await request(apiServer + 'orders', { method: 'post', body: params, json: true });
}

async function getOrdersByWeb(coin) {
  const url = `${webServer}coin/${coin}/order`;
  const data = await request(url, { json: true });
}

async function getAllTicks() {
  const params = {};
  _sign(params);

  return await request(apiServer + 'allticker', { method: 'post', body: params, json: true });
}

async function getTrands() {
  return await request(webServer + 'coin/trends', { json: true });
}

module.exports = {
  getTicker,
  getDepth,
  getDepthByWeb,
  getOrders,
  getOrdersByWeb,
  getAllTicks,
  getTrands
};