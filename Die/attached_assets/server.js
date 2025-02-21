
const app = require("./keep_alive.js");
const bot = require("./cards_against_humanity_bot.js");
const port = 3000;

function getGameStatus() {
  const now = Date.now();
  const timeLeft = global.roundEndTime ? Math.max(0, Math.floor((global.roundEndTime - now) / 1000)) : 0;
  
  return {
    isActive: global.gameStarted || false,
    players: global.players?.length || 0,
    currentCzar: global.czar?.username || 'None',
    targetScore: global.targetScore || 5,
    blackCard: global.currentBlackCard?.text || 'Waiting for round to start...',
    submittedAnswers: Object.keys(global.submittedAnswers || {}).length || 0,
    timeLeft: timeLeft,
    leaderboard: global.leaderboard || {}
  };
}

app.get('/status', (req, res) => {
  res.json(getGameStatus());
});

app.get("/", (req, res) => {
  const status = getGameStatus();
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Die - Discord Game Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary: #ff69b4;
            --secondary: #00ffff;
            --background: #1a0f2e;
            --card-bg: #2a1b3e;
            --card-hover: #3a2b4e;
            --text: #ffffff;
            --text-secondary: #bb86fc;
            --success: #43b581;
            --warning: #faa61a;
            --error: #f04747;
            --gradient-1: #7289da;
            --gradient-2: #5865f2;
            --gradient-3: #43b581;
          }

          * { margin: 0; padding: 0; box-sizing: border-box; }
          
          body { 
            font-family: 'Inter', sans-serif;
            background: linear-gradient(-45deg, var(--background), var(--card-bg), var(--card-hover));
            background-size: 400% 400%;
            animation: gradient 15s ease infinite;
            color: var(--text);
            line-height: 1.6;
            min-height: 100vh;
            padding: 20px;
          }

          @keyframes gradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }

          @keyframes borderGlow {
            0%, 100% { border-color: var(--primary); }
            50% { border-color: var(--secondary); }
          }

          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
          }

          .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: linear-gradient(135deg, var(--card-bg) 0%, var(--background) 100%);
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            position: relative;
            overflow: hidden;
          }

          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
            animation: shimmer 2s infinite linear;
          }

          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }

          h1 {
            font-size: 3.5em;
            font-weight: 700;
            margin-bottom: 15px;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: titlePulse 3s ease-in-out infinite;
          }

          @keyframes titlePulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }

          .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 25px;
            margin-top: 30px;
          }

          .status-card {
            background: linear-gradient(135deg, var(--card-bg) 0%, rgba(26, 27, 46, 0.8) 100%);
            padding: 25px;
            border-radius: 16px;
            border: 2px solid transparent;
            background-clip: padding-box;
            animation: borderGlow 2s ease-in-out infinite;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.05);
          }

          .status-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, var(--gradient-1), var(--gradient-2), var(--gradient-3));
            opacity: 0;
            transition: opacity 0.3s ease;
          }

          .status-card:hover::before {
            opacity: 1;
          }

          .status-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
          }

          .status-card::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.05));
            pointer-events: none;
          }

          .card-title {
            font-size: 1.2em;
            color: var(--primary);
            margin-bottom: 15px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .card-value {
            font-size: 1.8em;
            font-weight: 700;
            color: var(--text);
            transition: all 0.3s ease;
          }

          .black-card {
            grid-column: 1 / -1;
            background: #000;
            color: #fff;
            padding: 35px;
            font-size: 1.4em;
            position: relative;
          }

          .black-card::before {
            content: '⚫';
            position: absolute;
            top: 20px;
            right: 20px;
            font-size: 1.5em;
            opacity: 0.5;
          }

          .online-status {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 10px 20px;
            background: rgba(114, 137, 218, 0.1);
            border-radius: 30px;
            margin-top: 15px;
            backdrop-filter: blur(5px);
          }

          .online-dot {
            width: 12px;
            height: 12px;
            background: var(--success);
            border-radius: 50%;
            position: relative;
          }

          .online-dot::after {
            content: '';
            position: absolute;
            width: 100%;
            height: 100%;
            background: inherit;
            border-radius: inherit;
            animation: pulse 2s infinite;
          }

          @keyframes pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(2); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }

          @media (max-width: 768px) {
            .container { padding: 10px; }
            .status-grid { grid-template-columns: 1fr; }
            h1 { font-size: 2.5em; }
            .card-value { font-size: 1.5em; }
          }
        </style>
        <script>
          function updateStatus() {
            fetch('/status')
              .then(response => response.json())
              .then(data => {
                const elements = document.querySelectorAll('.card-value');
                elements.forEach(el => {
                  el.style.transform = 'scale(1.1)';
                  el.style.opacity = '0.7';
                  setTimeout(() => {
                    el.style.transform = 'scale(1)';
                    el.style.opacity = '1';
                  }, 200);
                });
                document.getElementById('game-status').textContent = data.isActive ? '🎮 Active' : '⏸️ Waiting';
                document.getElementById('players-count').textContent = '👥 ' + data.players;
                document.getElementById('current-czar').textContent = '👑 ' + data.currentCzar;
                document.getElementById('target-score').textContent = '🎯 ' + data.targetScore;
                document.getElementById('submitted-answers').textContent = '📝 ' + data.submittedAnswers;
                document.getElementById('black-card-text').textContent = data.blackCard;
                
                // Add animation class
                const cards = document.querySelectorAll('.status-card');
                cards.forEach(card => {
                  card.classList.add('update-flash');
                  setTimeout(() => card.classList.remove('update-flash'), 500);
                });
              });
          }

          // Update every 3 seconds
          setInterval(updateStatus, 3000);
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Die</h1>
            <div class="online-status">
              <span class="online-dot"></span>
              Bot Online
            </div>
          </div>
          <div class="status-grid">
            <div class="status-card black-card">
              <div class="card-title">Current Black Card</div>
              <div class="card-value" id="black-card-text">${status.blackCard}</div>
            </div>
            <div class="status-card">
              <div class="card-title">Game Status</div>
              <div class="card-value" id="game-status">${status.isActive ? '🎮 Active' : '⏸️ Waiting'}</div>
            </div>
            <div class="status-card">
              <div class="card-title">Players</div>
              <div class="card-value" id="players-count">👥 ${status.players}</div>
            </div>
            <div class="status-card">
              <div class="card-title">Current Czar</div>
              <div class="card-value" id="current-czar">👑 ${status.currentCzar}</div>
            </div>
            <div class="status-card">
              <div class="card-title">Target Score</div>
              <div class="card-value" id="target-score">🎯 ${status.targetScore}</div>
            </div>
            <div class="status-card">
              <div class="card-title">Submitted Answers</div>
              <div class="card-value" id="submitted-answers">📝 ${status.submittedAnswers}</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
});
