const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

app.get("/", (req, res) => {
    res.send("Letter Duel is running!");
});
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Game state storage
const games = new Map();

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Create new game
    socket.on('create_game', () => {
        const gameCode = generateGameCode();
        games.set(gameCode, {
            code: gameCode,
            players: [{ id: socket.id, role: 'A', letter: null, ready: false }],
            status: 'waiting',
            round: 1,
            scoreA: 0,
            scoreB: 0,
            currentPhase: 'waiting',
            currentFirstLetter: null,
            currentSecondLetter: null,
            roundWinner: null,
            pickTimer: null,
            duelTimer: null
        });
        socket.join(gameCode);
        socket.emit('game_created', { gameCode, role: 'A' });
        console.log(`Game created: ${gameCode} by ${socket.id}`);
    });

    // Join existing game
    socket.on('join_game', (gameCode) => {
        const game = games.get(gameCode);
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }
        if (game.players.length >= 2) {
            socket.emit('error', 'Game is full');
            return;
        }
        game.players.push({ id: socket.id, role: 'B', letter: null, ready: false });
        socket.join(gameCode);
        socket.emit('game_joined', { gameCode, role: 'B', gameState: getGameState(game) });
        
        // Notify both players game is starting
        io.to(gameCode).emit('game_start', getGameState(game));
        
        // Start round 1
        startRound(gameCode);
    });

    // Player picks a letter
    socket.on('pick_letter', ({ gameCode, letter }) => {
        const game = games.get(gameCode);
        if (!game || game.currentPhase !== 'picking') return;
        
        const player = game.players.find(p => p.id === socket.id);
        if (player) {
            player.letter = letter;
            player.ready = true;
            socket.emit('letter_confirmed', { letter });
            
            // Check if both picked
            const bothPicked = game.players.every(p => p.letter !== null);
            if (bothPicked) {
                clearTimeout(game.pickTimer);
                revealAndStartDuel(gameCode);
            }
        }
    });

    // Player submits a word
    socket.on('submit_word', ({ gameCode, word }) => {
        const game = games.get(gameCode);
        if (!game || game.currentPhase !== 'duel' || game.roundWinner) return;
        
        const wordUpper = word.trim().toUpperCase();
        const isValid = wordUpper.length >= 2 &&
            wordUpper[0] === game.currentFirstLetter &&
            wordUpper[wordUpper.length - 1] === game.currentSecondLetter &&
            isValidEnglishWord(wordUpper);
        
        if (!isValid) {
            socket.emit('invalid_word', { word, reason: `Must start with ${game.currentFirstLetter} and end with ${game.currentSecondLetter}` });
            return;
        }
        
        // Declare winner
        const player = game.players.find(p => p.id === socket.id);
        game.roundWinner = player.role;
        game.currentPhase = 'finished';
        
        if (player.role === 'A') game.scoreA++;
        else game.scoreB++;
        
        clearTimeout(game.duelTimer);
        io.to(gameCode).emit('round_winner', {
            winner: player.role,
            word: wordUpper,
            scoreA: game.scoreA,
            scoreB: game.scoreB
        });
        
        // Next round or end game
        if (game.round >= 15) {
            io.to(gameCode).emit('game_over', { scoreA: game.scoreA, scoreB: game.scoreB });
            games.delete(gameCode);
        } else {
            setTimeout(() => startRound(gameCode), 3000);
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        // Handle disconnection - notify other player
        for (const [code, game] of games) {
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                io.to(code).emit('opponent_disconnected');
                games.delete(code);
                break;
            }
        }
    });
});

function getGameState(game) {
    return {
        status: game.status,
        round: game.round,
        scoreA: game.scoreA,
        scoreB: game.scoreB,
        currentPhase: game.currentPhase,
        currentFirstLetter: game.currentFirstLetter,
        currentSecondLetter: game.currentSecondLetter,
        players: game.players.map(p => ({ role: p.role, letter: p.letter }))
    };
}

function startRound(gameCode) {
    const game = games.get(gameCode);
    if (!game) return;
    
    game.currentPhase = 'picking';
    game.players.forEach(p => {
        p.letter = null;
        p.ready = false;
    });
    game.roundWinner = null;
    game.currentFirstLetter = null;
    game.currentSecondLetter = null;
    
    io.to(gameCode).emit('round_start', {
        round: game.round,
        phase: 'picking',
        timeLeft: 3
    });
    
    // 3 second pick timer
    game.pickTimer = setTimeout(() => {
        const gameNow = games.get(gameCode);
        if (gameNow && gameNow.currentPhase === 'picking') {
            // Auto-assign random letters to anyone who didn't pick
            gameNow.players.forEach(p => {
                if (!p.letter) {
                    p.letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
                }
            });
            revealAndStartDuel(gameCode);
        }
    }, 3000);
}

function revealAndStartDuel(gameCode) {
    const game = games.get(gameCode);
    if (!game) return;
    
    const letterA = game.players.find(p => p.role === 'A').letter;
    const letterB = game.players.find(p => p.role === 'B').letter;
    
    // Randomly choose which letter is first
    const random = Math.random() < 0.5;
    game.currentFirstLetter = random ? letterA : letterB;
    game.currentSecondLetter = random ? letterB : letterA;
    game.currentPhase = 'duel';
    
    io.to(gameCode).emit('duel_start', {
        firstLetter: game.currentFirstLetter,
        secondLetter: game.currentSecondLetter,
        timeLeft: 20
    });
    
    // 20 second duel timer
    game.duelTimer = setTimeout(() => {
        const gameNow = games.get(gameCode);
        if (gameNow && gameNow.currentPhase === 'duel' && !gameNow.roundWinner) {
            // Time's up - no winner
            io.to(gameCode).emit('timeout');
            if (gameNow.round >= 15) {
                io.to(gameCode).emit('game_over', { scoreA: gameNow.scoreA, scoreB: gameNow.scoreB });
                games.delete(gameCode);
            } else {
                gameNow.round++;
                startRound(gameCode);
            }
        }
    }, 20000);
}

function isValidEnglishWord(word) {
    const common = new Set([
        "THE","AND","FOR","YOU","ARE","THIS","THAT","WITH","FROM","HAVE","YOUR",
        "KNOW","GOOD","TIME","WORD","MAKE","LIKE","JUST","COME","BACK","GAME",
        "PLAY","DUEL","FAST","BRAVE","HOUSE","MOUSE","TRAIN","LIGHT","NIGHT",
        "ROUND","SCORE","LETTER","WORLD","HELLO","QUICK","GREEN","FRESH","DREAM",
        "FLAME","STONE","PEACE","QUEEN","KING","SWORD","DANCE","MUSIC","OCEAN",
        "RIVER","FOREST","BRIDGE","SMART","BRIGHT","SHARP","SOUND","TRUST","FRUIT"
    ]);
    return common.has(word) || (word.length >= 3 && /^[A-Z]+$/.test(word));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));