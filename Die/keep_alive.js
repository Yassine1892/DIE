
const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

module.exports = app;
