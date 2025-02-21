require('./server.js'); // Keep the bot alive

const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SlashCommandBuilder } = require('discord.js');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();

async function enhanceMessage(message, context) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{
        role: "system",
        content: "You are a charismatic, modern game show host with a flair for creating excitement. Use emojis, creative formatting, and engaging language. Keep responses concise but impactful. Add visual flair with unicode characters when appropriate."
      }, {
        role: "user",
        content: `Transform this game message into something exciting and visually appealing (be creative but brief): ${message}\nContext: ${context}\nAdd thematic elements based on the context.`
      }],
      temperature: 0.8,
      max_tokens: 150
    });
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI error:', error);
    return message;
  }
}

async function createDynamicEmbed(title, description, fields, context) {
  try {
    const enhancedDesc = await enhanceMessage(description, context);
    return new EmbedBuilder()
      .setColor(context === 'winner' ? '#FFD700' : context === 'game' ? '#00FF00' : '#0099FF')
      .setTitle(title)
      .setDescription(enhancedDesc)
      .addFields(fields);
  } catch (error) {
    console.error('Embed creation error:', error);
    return new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle(title)
      .setDescription(description)
      .addFields(fields);
  }
}

const healthchecksUrl = process.env.HEALTHCHECKS_URL;

async function sendHeartbeat() {
  if (!healthchecksUrl) return;
  try {
    const response = await fetch(healthchecksUrl, {
      method: 'POST',
      headers: { 'User-Agent': 'DIE Discord Bot' }
    });
    if (!response.ok) {
      console.error('Healthbeat failed:', response.status, response.statusText);
    } else {
      console.log('Healthbeat sent successfully');
    }
  } catch (error) {
    console.error('Error sending heartbeat:', error);
  }
}

// Send heartbeat every 5 minutes
setInterval(sendHeartbeat, 5 * 60 * 1000);
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const token = process.env.BOT_TOKEN;

class GameState {
  constructor() {
    this.gameStarted = false;
    this.players = [];
    this.czar = null;
    this.currentBlackCard = null;
    this.submittedAnswers = {};
    this.votes = {};
    this.leaderboard = {};
    this.answerSubmitters = {};
    this.gameMessage = null;
    this.gameLeader = null;
    this.waitingForLeaderToStart = false;
  }

  reset() {
    this.gameStarted = false;
    this.players = [];
    this.czar = null;
    this.currentBlackCard = null;
    this.submittedAnswers = {};
    this.votes = {};
    this.leaderboard = {};
    this.answerSubmitters = {};
    this.gameMessage = null;
    this.gameLeader = null;
    this.waitingForLeaderToStart = false;
  }
}

const gameState = new GameState();

function initializeGameMessage(channel) {
    if (!gameMessage) {
        channel.send('Initializing game...').then(msg => {
            gameMessage = msg;
        });
    }
}

let targetScore = 5;
let cardPacks = ['cards'];
let availableCardPacks = [];
let currentCategory = 'random';

let answerTimeout;
let czarTimeout;
let inactivityTimeouts = {};
const answerTimeLimit = 150000; // 150 seconds for submitting answers
const czarTimeLimit = 120000;   // 120 seconds for czar to choose
const roundDelay = 10000;       // 10 seconds between rounds
const joinTimeLimit = 150000;   // 150 seconds for joining
const inactivityLimit = 300000;

let blackCards = []; // Will be populated from category files
let categoryCards = {
    random: [],
    awkward_moments: [],
    dark_humor: [],
    pop_culture: [],
    absurd_scenarios: [],
    everyday_life: [],
    relationships: [],
    extremely_funny_naughty: []
};

function loadCardPack(packName) {
    try {
        if (packName === 'Random') {
            // Combine cards from all categories
            categoryCards.random = [];
            const categories = ['Awkward Moments', 'Dark Humor', 'Pop Culture', 'Absurd Moments', 'Everyday Life', 'Relationships', '😈🔥'];

            categories.forEach(category => {
                try {
                    const data = JSON.parse(fs.readFileSync(`./attached_assets/${category}.json`, 'utf-8'));
                    const categoryKey = Object.keys(data)[0];
                    const cards = data[categoryKey].map(text => ({ text, blanks: 1 }));
                    categoryCards.random.push(...cards);
                    // Also use these as black cards since we don't have a separate cards.json
                    blackCards.push(...cards);
                } catch (err) {
                    console.error(`Error loading category ${category}:`, err);
                }
            });

            // Shuffle both arrays
            shuffleArray(categoryCards.random);
            shuffleArray(blackCards);
            return true;
        }

        const cardData = JSON.parse(fs.readFileSync(`./attached_assets/${packName}.json`, 'utf-8'));
        const categoryKey = Object.keys(cardData)[0];
        const cards = cardData[categoryKey].map(text => ({ text, blanks: 1 }));

        switch(packName) {
            case 'Awkward Moments':
                categoryCards.awkward_moments = cards;
                break;
            case 'Dark Humor':
                categoryCards.dark_humor = cards;
                break;
            case 'Pop Culture':
                categoryCards.pop_culture = cards;
                break;
            case 'Absurd Moments':
                categoryCards.absurd_scenarios = cards;
                break;
            case 'Everyday Life':
                categoryCards.everyday_life = cards;
                break;
            case 'Relationships':
                categoryCards.relationships = cards;
                break;
            case '😈🔥':
                categoryCards.extremely_funny_naughty = cards;
                break;
        }

        // Also use these cards as black cards
        blackCards.push(...cards);
        console.log(`Card pack "${packName}" loaded successfully.`);
        return true;
    } catch (error) {
        console.error(`Error loading card pack "${packName}":`, error);
        return false;
    }
}

function loadAvailableCardPacks() {
    const packs = ['Random', 'Awkward Moments', 'Dark Humor', 'Pop Culture', 'Absurd Moments', 'Everyday Life', 'Relationships', '😈🔥'];
    packs.forEach(pack => loadCardPack(pack));
    availableCardPacks = packs;
}

function kickPlayer(playerId) {
  const playerIndex = gameState.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return false;

  gameState.players.splice(playerIndex, 1);
  delete gameState.leaderboard[playerId];
  delete gameState.submittedAnswers[playerId];
  delete inactivityTimeouts[playerId];

  return true;
}

function resetInactivityTimer(playerId) {
  if (!gameState.gameStarted) return;

  if (inactivityTimeouts[playerId]) {
    clearTimeout(inactivityTimeouts[playerId]);
  }

  inactivityTimeouts[playerId] = setTimeout(() => {
    kickPlayer(playerId);
  }, inactivityLimit);
}

function createArtisticTimer(timeLeft, totalTime) {
  const percent = timeLeft / totalTime;
  const frames = ['⏳', '⌛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'];
  const frame = frames[Math.floor(Date.now() / 500) % frames.length];
  const filled = '🟦';
  const empty = '⬜';
  const barLength = 10;
  const filledBlocks = Math.round(percent * barLength);
  const emptyBlocks = barLength - filledBlocks;
  const seconds = Math.ceil(timeLeft / 1000);
  const urgency = seconds < 10 ? '🔥' : seconds < 30 ? '⚡' : '⏰';
  return `${frame} ${filled.repeat(filledBlocks)}${empty.repeat(emptyBlocks)} ${urgency} ${seconds}s`;
}

function getRandomEmoji() {
  const emojis = ['🎮', '🎲', '🎯', '🎪', '🎨', '🎭', '🎪', '🎡'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

function getPlayerColor(index) {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
  return colors[index % colors.length];
}


function shuffleArray(array) {
  if (!Array.isArray(array)) {
    console.error('shuffleArray called with non-array:', array);
    return;
  }
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function startGame(interaction) {
  console.log('startGame function called');

  try {
    if (gameState.gameStarted) {
      console.log('Game already in progress');
      return interaction.reply({ content: 'A game is already in progress.', ephemeral: true });
    }

    // Load black cards for current category
    if (currentCategory === 'random') {
      loadCardPack('Random');
    } else {
      // Convert category name to proper format for file loading
      const categoryFileName = currentCategory
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      loadCardPack(categoryFileName);
    }

    if (!blackCards || blackCards.length === 0) {
      console.error('No black cards loaded');
      return interaction.reply({ content: 'Failed to load cards. Please try again.', ephemeral: true });
    }

    if (gameState.gameLeader && gameState.gameLeader !== interaction.user.id && gameState.waitingForLeaderToStart) {
      return interaction.reply({ content: 'A game is waiting for the leader to start.', ephemeral: true });
    }

    if (gameState.gameLeader && gameState.gameLeader === interaction.user.id && gameState.waitingForLeaderToStart) {
      gameState.waitingForLeaderToStart = false;

      if (gameState.players.length < 2) {
        return interaction.reply({ content: 'Not enough players to start the game.', ephemeral: true });
      }

      if (!loadCardPack('cards')) {
        console.log('Failed to load card pack');
        return interaction.reply({ content: `Failed to load the card pack "cards.json".`, ephemeral: true });
      }

      console.log('Card pack loaded successfully');

      gameState.gameStarted = true;
      shuffleArray(gameState.players);
      gameState.czar = gameState.players[0];

      gameState.players.forEach(player => {
        gameState.leaderboard[player.id] = 0;
      });

      // Select initial black card
      gameState.currentBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];

      const gameStartEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎉 Game Started! 🎉')
        .setDescription(`**Players:**\n${gameState.players.map(p => `- ${p.username}`).join('\n')}\n\n${gameState.czar.username} is the first Card Czar!\nTarget score: **${targetScore}**`)
        .addFields(
          { name: '📜 First Black Card', value: `>>> ${gameState.currentBlackCard.text}` }
        )
        .setFooter({ text: 'Good luck!' });

      gameState.gameMessage = await interaction.channel.send({ embeds: [gameStartEmbed] }); 
      nextRound(interaction.channel); 

    } else {
      gameState.gameLeader = interaction.user.id; 
      gameState.players = [interaction.user]; 
      gameState.waitingForLeaderToStart = true;

      const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
const getPlayerColor = (index) => playerColors[index % playerColors.length];

const playersList = gameState.players.map((p, i) => {
    const isLeader = p.id === gameState.gameLeader;
    const color = getPlayerColor(i);
    return `• \`${isLeader ? '👑 ' : ''}${p.username}\` [\`${color}\`]`;
}).join('\n');

const lobbyEmbed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle('🎮 Cards Against Humanity - New Game')
        .setDescription('*A party game for horrible people.*')
        .addFields(
          { name: '👑 Game Leader', value: `\`${interaction.user.username}\``, inline: true },
          { name: '🎯 Target Score', value: `\`${targetScore} points\``, inline: true },
          { name: '📦 Card Pack', value: `\`${cardPacks[0]}\``, inline: true },
          { name: '👥 Players', value: playersList || 'No players yet', inline: false },
          { name: '📋 How to Join', value: '```Click the "Join Game" button below to join the fun!```', inline: false },
          { name: '⚡ Quick Rules', value: '```diff\n+ 1. Join the game\n+ 2. Leader starts when ready\n+ 3. Submit funny answers\n+ 4. Card Czar picks the best one\n+ 5. First to target score wins!\n```' }
        )
        .setFooter({ text: '⏳ Waiting for more players to join...' });

      const joinButton = new ButtonBuilder() 
        .setCustomId('join_game')
        .setLabel('Join Game')
        .setStyle(ButtonStyle.Primary);

      const startButton = new ButtonBuilder() 
        .setCustomId('start_game')
        .setLabel('Start Game')
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder()
        .addComponents(joinButton, startButton);

      await interaction.reply({ embeds: [lobbyEmbed], components: [row] }); 
    }

  } catch (error) {
    console.error('Error in startGame function:', error);
      await interaction.reply({ content: 'A game is already in progress.', flags: 64 });
  }
}

async function updateLobbyEmbed(interaction) {
  const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
  const getPlayerColor = (index) => playerColors[index % playerColors.length];

  const playersList = gameState.players.map((p, i) => {
    const isLeader = p.id === gameState.gameLeader;
    const color = getPlayerColor(i);
    return `• \`${isLeader ? '👑 ' : ''}${p.username}\` [\`${color}\`]`;
  }).join('\n');

  const lobbyEmbed = new EmbedBuilder()
    .setColor(0x7289DA)
    .setTitle('🎮 Cards Against Humanity - Lobby')
    .setDescription(`*${gameState.players.length} player${gameState.players.length !== 1 ? 's' : ''} in lobby*`)
    .addFields(
      { name: '👑 Game Leader', value: `\`${gameState.players[0].username}\``, inline: true },
      { name: '🎯 Target Score', value: `\`${targetScore} points\``, inline: true },
      { name: '📦 Category', value: `\`${currentCategory.replace('_', ' ').toUpperCase()}\``, inline: true },
      { name: '👥 Players', value: playersList || 'No players yet', inline: false },
      { name: '📋 How to Join', value: '```Click the "Join Game" button below to join the fun!```', inline: false }
    )
    .setFooter({ text: gameState.players.length >= 2 ? '✅ Ready to start!' : `❌ Need ${2 - gameState.players.length} more player(s)` });

  const joinButton = new ButtonBuilder()
    .setCustomId('join_game')
    .setLabel('Join Game')
    .setStyle(ButtonStyle.Primary);

  const startButton = new ButtonBuilder()
    .setCustomId('start_game')
    .setLabel('Start Game')
    .setStyle(ButtonStyle.Success)
    .setDisabled(gameState.players.length < 2);

  const row = new ActionRowBuilder()
    .addComponents(joinButton, startButton);

  try {
    await interaction.message.edit({ embeds: [lobbyEmbed], components: [row] });
  } catch (error) {
    console.error('Error updating lobby embed:', error);
  }
}

async function addPlayer(interaction) { 
  if (gameState.gameStarted) {
    return interaction.reply({ content: 'A game is already in progress.', ephemeral: true }); 
  }

  if (!gameState.waitingForLeaderToStart) {
    return interaction.reply({ content: 'The game is not currently accepting new players.', ephemeral: true });
  }

  const player = interaction.user;
  if (gameState.players.find(p => p.id === player.id)) {
    return interaction.reply({ content: 'You are already in the game!', ephemeral: true }); 
  }

  gameState.players.push(player);
  await updateLobbyEmbed(interaction);

  const joinEmbed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setDescription(`${player.username} joined the game!`);

  await interaction.reply({ embeds: [joinEmbed], ephemeral: true }); 
}

async function submitAnswer(player, answerText, message) {
  if (!gameState.gameStarted) {
    return;
  }

  if (player.id === gameState.czar.id) {
    return;  // Silently ignore Czar's messages
  }

  if (!gameState.players.find(p => p.id === player.id)) {
    return;  // Silently ignore non-player messages
  }

  if (gameState.submittedAnswers[player.id]) {
    return message.reply({ content: 'You have already submitted an answer.', ephemeral: true });
  }

  if (!answerText) {
    return;
  }

  gameState.submittedAnswers[player.id] = answerText;
  gameState.answerSubmitters[player.id] = player.username;

  try {
    await message.delete();
    const submitEmbed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setDescription(`✅ ${player.username} has submitted their answer!`);
    await message.channel.send({ embeds: [submitEmbed] });

    // If all players have submitted, show answers
    if (Object.keys(gameState.submittedAnswers).length === gameState.players.filter(p => p.id !== gameState.czar.id).length) {
      clearTimeout(answerTimeout);
      await displayAnswersAndStartVoting(message.channel);
    }
  } catch (error) {
    console.error('Error handling answer submission:', error);
  }

  if (Object.keys(gameState.submittedAnswers).length === gameState.players.filter(p => p.id !== gameState.czar.id).length) {
    console.log('All players have submitted their answers.');
    clearTimeout(answerTimeout);
    displayAnswersAndStartVoting(message.channel); 
  }

  return true;
}

async function displayBlackCard(channel) {
  const border = '•°•°•°•°•°•°•°•°•°•°•°•°•°•°•°•°•';
  const blackCardEmbed = new EmbedBuilder()
    .setColor('#000000')
    .setTitle(`${border}\n📜 BLACK CARD 📜\n${border}`)
    .setDescription(`>>> # ${gameState.currentBlackCard.text}`)
    .addFields([
      { name: '⏰ Time', value: createArtisticTimer(answerTimeLimit, answerTimeLimit), inline: true },
      { name: '👑 Czar', value: gameState.czar.username, inline: true },
      { name: '📝 Answers', value: `${Object.keys(gameState.submittedAnswers).length}/${gameState.players.length - 1}`, inline: true }
    ])
    .setFooter({ text: `✨ Submit your answers in chat! | Round ${Object.keys(gameState.leaderboard).length + 1}` });

  const progressBar = createProgressBar(Object.keys(gameState.submittedAnswers).length / (gameState.players.length - 1));
  const statusEmbed = new EmbedBuilder()
    .setColor('#4CAF50')
    .setDescription(`**Progress:** ${progressBar}\n*Waiting for players to submit their answers...*`);

  gameState.gameMessage = await channel.send({ embeds: [blackCardEmbed, statusEmbed] });

  answerTimeout = setTimeout(() => {
    if (Object.keys(gameState.submittedAnswers).length === 0) {
      channel.send("No answers were submitted this round. Skipping round.");
      nextRound(channel);
      return;
    }
    displayAnswersAndStartVoting(channel);
  }, answerTimeLimit);
}

async function displayAnswersAndStartVoting(channel) {
  clearTimeout(answerTimeout);

  const answers = Object.values(gameState.submittedAnswers);
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  if (answers.length === 0) {
    channel.send("No answers were submitted this round. Skipping round.");
    nextRound(channel);
    return;
  }

  const shuffledAnswers = [...answers];
  shuffleArray(shuffledAnswers);

  let answersList = shuffledAnswers.map((answer, index) => 
    `${emojis[index]} ┃ ${answer}`
  ).join('\n\n');

  // Announcement embed for all players
  const announcementEmbed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('🎭 All Answers Submitted! 🎭')
    .setDescription('Here are all the submitted answers:')
    .addFields(
      { name: '📜 The Question', value: `>>> ${gameState.currentBlackCard.text}` },
      { name: '🃏 The Answers', value: answersList || '*No answers submitted.*' }
    )
    .setFooter({ text: `${gameState.czar.username} is choosing the winner...` });

  await channel.send({ embeds: [announcementEmbed] });

  // Czar-specific embed
  const czarEmbed = new EmbedBuilder()
    .setColor('#FF4500')
    .setTitle('🎯 Time to Choose!')
    .setDescription(`*${gameState.czar.username}*, type a number \`(1-${shuffledAnswers.length})\` to choose the winner!`)
    .addFields(
      { name: '📜 The Question', value: `>>> ${gameState.currentBlackCard.text}` },
      { name: '🃏 The Answers', value: answersList }
    );

  const fields = [
    { name: '📜 The Question', value: `>>> ${gameState.currentBlackCard.text}` },
    { name: '🃏 The Answers', value: answersList || '*No answers submitted.*' },
    { name: '👑 Czar\'s Choice', value: `*${gameState.czar.username}*, choose wisely! Type a number \`(1-${Object.keys(gameState.submittedAnswers).length})\`` }
  ];

  const votingEmbed = await createDynamicEmbed(
    '🎭 Time to Choose the Winner! 🎭',
    '*May the funniest answer win!*',
    fields,
    'voting'
  );

  votingEmbed
    .setColor('#FFD700')
    .setFooter({ text: createArtisticTimer(timeLeft, answerTimeLimit) })
    .setTimestamp();

  await displayBlackCard(channel);

  answerTimeout = setTimeout(() => {
    if (Object.keys(gameState.submittedAnswers).length === 0) {
      channel.send("No answers were submitted this round. Skipping round.");
      nextRound(channel);
      return;
    }
    displayAnswersAndStartVoting(channel);
  }, answerTimeLimit);
}

function displayLeaderboard(channel) {
  let leaderboardText = '🏆 **Leaderboard** 🏆\n\n';
  const sortedPlayers = Object.entries(gameState.leaderboard)
    .sort(([,a], [,b]) => b - a);

  sortedPlayers.forEach(([playerId, score], index) => {
    const player = gameState.players.find(p => p.id === playerId);
    const color = getPlayerColor(index);
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▫️';
    leaderboardText += `${medal} \`${player.username}\` [\`${color}\`]: **${score}** points\n`;
  });

  const leaderboardEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setDescription(leaderboardText)
    .setFooter({ text: '🎮 May the best player win!' });
  channel.send({ embeds: [leaderboardEmbed] });
}

function determineWinner() {
  let winner = null;
  let maxPoints = 0;

  for (const playerId in gameState.leaderboard) {
    if (gameState.leaderboard[playerId] > maxPoints) {
      maxPoints = gameState.leaderboard[playerId];
      winner = gameState.players.find(p => p.id === playerId);
    }
  }

  return { winner, points: maxPoints };
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadAvailableCardPacks();

    // Statistics tracking
let playerStats = {};
let playerAchievements = {};

function updatePlayerStats(playerId, type) {
    if (!playerStats[playerId]) {
        playerStats[playerId] = {
            gamesPlayed: 0,
            wins: 0,
            roundsWon: 0,
            timesAsCzar: 0
        };
    }

    switch(type) {
        case 'game':
            playerStats[playerId].gamesPlayed++;
            break;
        case 'win':
            playerStats[playerId].wins++;
            break;
        case 'round':
            playerStats[playerId].roundsWon++;
            break;
        case 'czar':
            playerStats[playerId].timesAsCzar++;
            break;
    }
}

// Custom cards storage
let customCards = {};
let customCardPacks = {};
let gameHistory = [];
let achievements = {
  // Gameplay Achievements
  'first_win': { name: 'First Victory', description: 'Win your first game' },
  'czar_master': { name: 'Czar Master', description: 'Win 5 rounds as Czar' },
  'quick_wit': { name: 'Quick Wit', description: 'Submit an answer in under 10 seconds' },
  'winning_streak': { name: 'Hot Streak', description: 'Win 3 rounds in a row' },
  'perfect_game': { name: 'Perfect Game', description: 'Win a game without losing a single round' },

  // Social Achievements
  'party_starter': { name: 'Party Starter', description: 'Start 10 games' },
  'crowd_favorite': { name: 'Crowd Favorite', description: 'Get selected as winner by 5 different Czars' },
  'social_butterfly': { name: 'Social Butterfly', description: 'Play with 20 different players' },

  // Category Master Achievements
  'dark_master': { name: 'Dark Humor Master', description: 'Win 5 rounds in Dark Humor category' },
  'pop_master': { name: 'Pop Culture Guru', description: 'Win 5 rounds in Pop Culture category' },
  'awkward_master': { name: 'Awkward Expert', description: 'Win 5 rounds in Awkward Moments category' },

  // Special Achievements
  'speed_demon': { name: 'Speed Demon', description: 'Be the first to submit 20 times' },
  'comeback_king': { name: 'Comeback King', description: 'Win after being in last place' },
  'creative_genius': { name: 'Creative Genius', description: 'Create a custom card that gets used 10 times' },
  'tournament_victor': { name: 'Tournament Champion', description: 'Win a tournament' }
};

let tournaments = {};
let teams = {};

const languages = {
  'en': require('../attached_assets/lang/en.json'),
  'es': require('../attached_assets/lang/es.json'),
  'fr': require('../attached_assets/lang/fr.json'),
  'de': require('../attached_assets/lang/de.json'),
  'pl': require('../attached_assets/lang/pl.json'),
  'hi': require('../attached_assets/lang/hi.json')
};

const commands = [
        new SlashCommandBuilder()
            .setName('start')
            .setDescription('Start a new game of Cards Against Humanity'),
        new SlashCommandBuilder()
            .setName('rules')
            .setDescription('Display the game rules'),
        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('Skip an inactive player\'s turn'),
        new SlashCommandBuilder()
            .setName('stats')
            .setDescription('View your game statistics'),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Display help information about the bot'),
        new SlashCommandBuilder()
            .setName('category')
            .setDescription('Set the card category for the game')
            .addStringOption(option =>
                option.setName('name')
                    .setDescription('Category name')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Random', value: 'random' },
                        { name: 'Awkward Moments', value: 'awkward_moments' },
                        { name: 'Dark Humor', value: 'dark_humor' },
                        { name: 'Pop Culture', value: 'pop_culture' },
                        { name: 'Absurd Scenarios', value: 'absurd_scenarios' },
                        { name: 'Everyday Life', value: 'everyday_life' },
                        { name: 'Relationships', value: 'relationships' },
                        { name: 'Extremely Funny', value: 'extremely_funny_naughty' }
                    )),
        new SlashCommandBuilder()
            .setName('endgame')
            .setDescription('End the current game (leader only)'),
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Display the current leaderboard'),
        new SlashCommandBuilder()
            .setName('setscore')
            .setDescription('Set the target score for winning')
            .addIntegerOption(option =>
                option.setName('score')
                    .setDescription('Target score')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(20)),
        new SlashCommandBuilder()
            .setName('createcard')
            .setDescription('Create a custom card')
            .addStringOption(option =>
                option.setName('text')
                    .setDescription('Card text')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('Card type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Black', value: 'black' },
                        { name: 'White', value: 'white' }
                    )),
        new SlashCommandBuilder()
            .setName('cardpack')
            .setDescription('Manage card packs')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('create')
                    .setDescription('Create a new card pack')
                    .addStringOption(option =>
                        option.setName('name')
                            .setDescription('Pack name')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('delete')
                    .setDescription('Delete a card pack')
                    .addStringOption(option =>
                        option.setName('name')
                            .setDescription('Pack name')
                            .setRequired(true))),
        new SlashCommandBuilder()
            .setName('history')
            .setDescription('View game history'),
        new SlashCommandBuilder()
            .setName('achievements')
            .setDescription('View your achievements'),
        new SlashCommandBuilder()
            .setName('team')
            .setDescription('Team management')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('create')
                    .setDescription('Create ateam')
                    .addStringOption(option =>
                        option.setName('name')
                            .setDescription('Team name')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('join')
                    .setDescription('Join a team')
                    .addStringOption(option =>
                        option.setName('name')
                            .setDescription('Team name')
                            .setRequired(true))),
        new SlashCommandBuilder()
            .setName('tournament')
            .setDescription('Tournament management')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('create')
                    .setDescription('Create a tournament')
                    .addStringOption(option =>
                        option.setName('name')
                            .setDescription('Tournament name')
                            .setRequired(true))),
        new SlashCommandBuilder()
            .setName('language')
            .setDescription('Set your language')
            .addStringOption(option =>
                option.setName('lang')
                    .setDescription('Language code')
                    .setRequired(true)
                    .addChoices(
                        { name: 'English', value: 'en' },
                        { name: 'Español', value: 'es' },
                        { name: 'Français', value: 'fr' },
                        { name: 'Deutsch', value: 'de' },
                        { name: 'Polski', value: 'pl' },
                        { name: 'हिंदी', value: 'hi' }
                    )),
        new SlashCommandBuilder()
            .setName('filter')
            .setDescription('Set content filter level')
            .addStringOption(option =>
                option.setName('level')
                    .setDescription('Filter level')
                    .setRequired(true)
                    .addChoices(
                        { name: 'None', value: 'none' },
                        { name: 'Mild', value: 'mild' },
                        { name: 'Strict', value: 'strict' }
                    )),
        new SlashCommandBuilder()
            .setName('preview')
            .setDescription('Preview questions from each category')

    ];

    client.application.commands.set(commands);
    console.log('Slash commands registered!');
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (gameState.gameStarted && !message.content.startsWith('/')) {
        await submitAnswer(message.author, message.content, message);
        return;
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isButton()) {
        if (interaction.customId === 'join_game') {
            await addPlayer(interaction);
        } else if (interaction.customId === 'start_game') {
            await startGame(interaction);
        }
        return;
    }

    const { commandName } = interaction;

    try {
        switch (commandName) {
            case 'rules':
                const rulesEmbed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('Cards Against Humanity - Rules')
                    .setDescription('How to play:')
                    .addFields(
                        { name: '1. Setup', value: 'One player is the Card Czar, everyone else answers' },
                        { name: '2. Black Card', value: 'The Card Czar reads the Black Card' },
                        { name: '3. White Cards', value: 'Players submit their funniest White Card' },
                        { name: '4. Voting', value: 'The Card Czar picks their favorite answer' },
                        { name: '5. Scoring', value: 'Winner gets a point, first to target score wins!' }
                    );
                await interaction.reply({ embeds: [rulesEmbed] });
                break;

            case 'skip':
                if (!gameState.gameStarted) {
                    await interaction.reply('No game is currently in progress.');
                    return;
                }
                if (interaction.user.id !== gameState.gameLeader) {
                    await interaction.reply('Only the game leader can skip players.');
                    return;
                }
                const inactivePlayers = gameState.players.filter(p => !gameState.submittedAnswers[p.id] && p.id !== gameState.czar.id);
                if (inactivePlayers.length === 0) {
                    await interaction.reply('No inactive players to skip.');
                    return;
                }
                inactivePlayers.forEach(player => {
                    kickPlayer(player.id);
                });
                await interaction.reply(`Skipped ${inactivePlayers.length} inactive player(s).`);
                if (Object.keys(gameState.submittedAnswers).length === gameState.players.filter(p => p.id !== gameState.czar.id).length) {
                    displayAnswersAndStartVoting(interaction.channel);
                }
                break;

            case 'stats':
                const userStats = playerStats[interaction.user.id] || {
                    gamesPlayed: 0,
                    wins: 0,
                    roundsWon: 0,
                    timesAsCzar: 0
                };
                const statsEmbed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`${interaction.user.username}'s Statistics`)
                    .addFields(
                        { name: 'Games Played', value: userStats.gamesPlayed.toString(), inline: true },
                        { name: 'Games Won', value: userStats.wins.toString(), inline: true },
                        { name: 'Rounds Won', value: userStats.roundsWon.toString(), inline: true },
                        { name: 'Times as Czar', value: userStats.timesAsCzar.toString(), inline: true }
                    );
                await interaction.reply({ embeds: [statsEmbed] });
                break;

            case 'help':
                const helpEmbed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('Die - Commands')
                    .setDescription('Here are all available commands:')
                    .addFields(
                        { name: '/start', value: 'Start a new game' },
                        { name: '/category', value: 'Set card category (Random, Awkward Moments, Dark Humor, Pop Culture)' },
                        { name: '/setscore', value: 'Set the target score (1-20)' },
                        { name: '/endgame', value: 'End the current game' },
                        { name: '/leaderboard', value: 'View the current standings' }
                    );
                await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
                break;

            case 'category':
                if (gameState.gameStarted) {
                    await interaction.reply({ content: 'Cannot change category while a game is in progress.', ephemeral: true });
                    return;
                }
                const category = interaction.options.getString('name');
                currentCategory = category;
                await interaction.reply(`Category set to ${category.replace('_', ' ').toUpperCase()}`);
                break;

            case 'start':
                await startGame(interaction);
                break;

            case 'endgame':
                if (!gameState.players.some(player => player.id === interaction.user.id)) {
                    await interaction.reply({ content: 'Only players in the game can end it.', ephemeral: true });
                    return;
                }
                gameState.reset();
                await interaction.reply(`The game has been ended by ${interaction.user.username}.`);
                break;

            case 'leaderboard':
                if (Object.keys(gameState.leaderboard).length === 0) {
                    await interaction.reply('No active game or leaderboard data available.');
                    return;
                }
                const leaderboardEmbed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('🏆 Current Leaderboard 🏆')
                    .setDescription(Object.entries(gameState.leaderboard)
                        .sort(([,a], [,b]) => b - a)
                        .map(([playerId, score], index) => {
                            const player = gameState.players.find(p => p.id === playerId);
                            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▫️';
                            return `${medal} **${player?.username || 'Unknown Player'}:** ${score} points`;
                        })
                        .join('\n')
                    );
                await interaction.reply({ embeds: [leaderboardEmbed] });
                break;

            case 'setscore':
                if (gameState.gameStarted) {
                    await interaction.reply({ content: 'Cannot change score while a game is in progress.', ephemeral: true });
                    return;
                }
                const newScore = interaction.options.getInteger('score');
                targetScore = newScore;
                await interaction.reply(`Target score set to ${targetScore}.`);
                break;

            case 'achievements':
                const userAchievs = playerAchievements[interaction.user.id] || [];
                const achievementsEmbed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle(`${interaction.user.username}'s Achievements`)
                    .setDescription(userAchievs.length > 0 
                        ? userAchievs.map(id => `🏆 **${achievements[id].name}**\n${achievements[id].description}`).join('\n\n')
                        : 'No achievements unlocked yet! Keep playing to earn some!');
                await interaction.reply({ embeds: [achievementsEmbed] });
                break;
            case 'preview':
                const preview = {
                    random: categoryCards.random[0]?.text || 'No random questions available',
                    awkward_moments: categoryCards.awkward_moments[0]?.text || 'No awkward moments available',
                    dark_humor: categoryCards.dark_humor[0]?.text || 'No dark humor available',
                    pop_culture: categoryCards.pop_culture[0]?.text || 'No pop culture questions available'
                };

                const previewEmbed = new EmbedBuilder()
                    .setTitle('Category Previews')
                    .setColor('#FF5733')
                    .addFields(
                        { name: 'Random', value: preview.random },
                        { name: 'Awkward Moments', value: preview.awkward_moments },
                        { name: 'Dark Humor', value: preview.dark_humor },
                        { name: 'Pop Culture', value: preview.pop_culture }
                    );

                await interaction.reply({ embeds: [previewEmbed], ephemeral: true });
                break;
        }
    } catch (error) {
        console.error('Command error:', {
            command: commandName,
            user: interaction.user.tag,
            error: error.message,
            stack: error.stack
        });

        const errorMessage = error.message.includes('permissions') 
            ? 'I don\'t have permission to perform this action.'
            : 'An error occurred while processing the command. Please try again.';

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

client.login(token);

function createProgressBar(progress) {
  const barLength = 20;
  const filledLength = Math.round(progress * barLength);
  const filled = '█'.repeat(filledLength);
  const empty = '░'.repeat(barLength - filledLength);
  return `[${filled}${empty}]`;
}