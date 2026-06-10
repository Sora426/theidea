const socket = io();

let roomId = "";

const params = new URLSearchParams(window.location.search);
const autoRoom = params.get("room");

if (autoRoom) {
    socket.emit("join-room", autoRoom);
    roomId = autoRoom;
}

document.getElementById("createBtn").onclick = () => {
    socket.emit("create-room");
};

document.getElementById("joinBtn").onclick = () => {

    roomId = document.getElementById("roomInput").value.trim().toUpperCase();
    socket.emit("join-room", roomId);
};

socket.on("room-created", (id) => {

    roomId = id;

    document.getElementById("room").innerText =
        `Room: ${id}`;

    window.history.replaceState({}, "", `?room=${id}`);

    createLetters();
});

socket.on("player-joined", (count) => {
    document.getElementById("status").innerText =
        `Players: ${count}/2`;
});

function createLetters() {

    const div = document.getElementById("letters");
    div.innerHTML = "";

    for (let i = 65; i <= 90; i++) {

        const btn = document.createElement("button");
        btn.textContent = String.fromCharCode(i);

        btn.onclick = () => {

            socket.emit("select-letter", {
                roomId,
                letter: btn.textContent
            });

            document.getElementById("status").innerText =
                "Waiting for opponent...";
        };

        div.appendChild(btn);
    }
}

socket.on("round-start", data => {

    document.getElementById("pair").innerText = data.pair;

    document.getElementById("status").innerText =
        `Round ${data.round}/10`;
});

document.getElementById("submitWord").onclick = () => {

    socket.emit("submit-word", {
        roomId,
        word: document.getElementById("wordInput").value
    });

    document.getElementById("wordInput").value = "";
};

socket.on("round-winner", data => {

    document.getElementById("score").innerText =
        `P1: ${data.scores.p1} | P2: ${data.scores.p2}`;

    document.getElementById("status").innerText =
        data.winner === "none"
            ? "Time up!"
            : `${data.winner} wins round`;
});

socket.on("next-round", data => {
    document.getElementById("status").innerText =
        `Round ${data.round}/10`;
});

socket.on("game-over", data => {

    document.getElementById("status").innerText =
        `Game Over - Winner: ${data.winner}`;

    document.getElementById("score").innerText =
        `Final: P1 ${data.scores.p1} | P2 ${data.scores.p2}`;
});

socket.on("error-message", msg => {
    alert(msg);
});