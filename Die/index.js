
const app = require('./attached_assets/keep_alive.js');
const bot = require('./attached_assets/cards_against_humanity_bot.js');

// Start the express server
app.listen(3000, '0.0.0.0', () => {
  console.log('Server is running on port 3000');
});
