
const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

// Export the app instead of starting it
module.exports = app;
