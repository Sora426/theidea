const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getPlayerNumber(room, socketId) {
    return room.players[0] === socketId ? "p1" : "p2";
}

io.on("connection", (socket) => {

    socket.on("create-room", () => {

        const roomId = generateRoomId();

        rooms[roomId] = {
            id: roomId,
            players: [],
            round: 1,
            maxRounds: 10,
            scores: { p1: 0, p2: 0 },
            letters: {},
            currentPair: null,
            winnerDeclared: false,
            timer: null
        };

        socket.join(roomId);
        rooms[roomId].players.push(socket.id);

        socket.emit("room-created", roomId);
    });

    socket.on("join-room", (roomId) => {

        const room = rooms[roomId];
        if (!room) return socket.emit("error-message", "Room not found");

        if (room.players.length >= 2)
            return socket.emit("error-message", "Room full");

        room.players.push(socket.id);
        socket.join(roomId);

        io.to(roomId).emit("player-joined", room.players.length);
    });

    socket.on("select-letter", ({ roomId, letter }) => {

        const room = rooms[roomId];
        if (!room) return;

        room.letters[socket.id] = letter.toUpperCase();

        if (Object.keys(room.letters).length === 2) {

            const letters = Object.values(room.letters);

            room.currentPair =
                Math.random() < 0.5
                    ? letters[0] + letters[1]
                    : letters[1] + letters[0];

            room.winnerDeclared = false;

            startTimer(roomId);

            io.to(roomId).emit("round-start", {
                pair: room.currentPair,
                round: room.round
            });
        }
    });

    socket.on("submit-word", ({ roomId, word }) => {

        const room = rooms[roomId];
        if (!room || room.winnerDeclared) return;

        word = word.trim().toUpperCase();

        const start = room.currentPair[0];
        const end = room.currentPair[1];

        if (word.startsWith(start) && word.endsWith(end)) {

            room.winnerDeclared = true;

            const player = getPlayerNumber(room, socket.id);
            room.scores[player]++;

            clearTimeout(room.timer);

            io.to(roomId).emit("round-winner", {
                winner: player,
                scores: room.scores
            });

            setTimeout(() => nextRound(roomId), 2500);
        }
    });

    function startTimer(roomId) {

        const room = rooms[roomId];

        clearTimeout(room.timer);

        room.timer = setTimeout(() => {

            if (!room.winnerDeclared) {
                io.to(roomId).emit("round-winner", {
                    winner: "none",
                    scores: room.scores
                });

                nextRound(roomId);
            }

        }, 15000);
    }

    function nextRound(roomId) {

        const room = rooms[roomId];
        if (!room) return;

        room.round++;
        room.letters = {};
        room.currentPair = null;
        room.winnerDeclared = false;

        if (room.round > room.maxRounds) {

            let winner = "Draw";

            if (room.scores.p1 > room.scores.p2) winner = "Player 1";
            if (room.scores.p2 > room.scores.p1) winner = "Player 2";

            io.to(roomId).emit("game-over", {
                scores: room.scores,
                winner
            });

            delete rooms[roomId];
            return;
        }

        io.to(roomId).emit("next-round", {
            round: room.round
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Running on", PORT));