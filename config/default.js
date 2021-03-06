'use strict';

module.exports = {
  app: {
    port: 1699
  },
  storage: {
    mysql: {
      database: 'emarket-trader',
      username: null,
      password: null,
      options: {
        host: 'localhost',
        port: 3306,
        dialect: 'mysql',
        pool: {
          max: 5,
          min: 0,
          idle: 10000
        }
      }
    }
  },
  market: {
    jubi: {
      apiServer: 'https://www.jubi.com/api/v1/',
      webServer: 'https://www.jubi.com/',
      key: null,
      secret: null,
    }
  }
}