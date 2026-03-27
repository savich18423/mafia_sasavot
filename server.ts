import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(distPath);
  const isDev = process.env.NODE_ENV !== "production" || process.env.AIS_PREVIEW === "true" || !hasDist;

  console.log(`Starting server in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`AIS_PREVIEW: ${process.env.AIS_PREVIEW}`);
  console.log(`Has dist folder: ${hasDist}`);

  
  let vite: any;
  if (isDev) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: process.cwd(),
    });
    app.use(vite.middlewares);
    console.log("Vite middleware initialized");
  }

 
  if (isDev) {
    app.use((req, res, next) => {
      const ext = path.extname(req.path);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        
        if (!res.getHeader('Content-Type')) {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('X-Content-Type-Options', 'nosniff');
        }
      }
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Ext: ${ext}`);
      next();
    });
  }

  
  const rooms = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", ({ playerName, maxPlayers }) => {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = {
        id: roomId,
        host: socket.id,
        players: [{ id: socket.id, name: playerName, peerId: null, role: null, isAlive: true, fruit: 'orange' }],
        maxPlayers: parseInt(maxPlayers) || 10,
        status: 'lobby', 
        gameData: {
          phase: 'waiting', 
          votes: {},
          logs: []
        }
      };
      rooms.set(roomId, room);
      socket.join(roomId);
      socket.emit("room-created", room);
    });

    socket.on("join-room", ({ roomId, playerName }) => {
      console.log(`Join attempt: Room ${roomId} by ${playerName}`);
      const room = rooms.get(roomId);
      if (!room) {
        console.log(`Join failed: Room ${roomId} not found. Available:`, Array.from(rooms.keys()));
        return socket.emit("error", "Room not found");
      }
      if (room.players.length >= room.maxPlayers) {
        return socket.emit("error", "Room is full");
      }
      if (room.status !== 'lobby') {
        return socket.emit("error", "Game already started");
      }

      const fruits = ['orange', 'apple', 'banana', 'strawberry', 'pear', 'grape', 'lemon', 'watermelon', 'pineapple', 'cherry'];
      const usedFruits = room.players.map(p => p.fruit);
      const availableFruits = fruits.filter(f => !usedFruits.includes(f));
      const fruit = availableFruits[0] || 'orange';

      const newPlayer = { id: socket.id, name: playerName, peerId: null, role: null, isAlive: true, fruit };
      room.players.push(newPlayer);
      socket.join(roomId);
      io.to(roomId).emit("room-updated", room);
    });

    socket.on("update-peer-id", ({ roomId, peerId }) => {
      const room = rooms.get(roomId);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.peerId = peerId;
          io.to(roomId).emit("room-updated", room);
        }
      }
    });

    socket.on("start-game", (roomId) => {
      const room = rooms.get(roomId);
      if (room && room.host === socket.id && room.players.length >= 5) {
        room.status = 'playing';
        
       
        const players = [...room.players];
        const mafiaCount = Math.max(1, Math.floor(players.length / 4));
        const shuffled = players.sort(() => 0.5 - Math.random());
        
        shuffled.forEach((p, i) => {
          const playerInRoom = room.players.find(rp => rp.id === p.id);
          if (i < mafiaCount) {
            playerInRoom.role = 'mafia';
          } else if (i === mafiaCount) {
            playerInRoom.role = 'doctor';
          } else if (i === mafiaCount + 1) {
            playerInRoom.role = 'detective';
          } else {
            playerInRoom.role = 'citizen';
          }
        });

        room.gameData.phase = 'night';
        io.to(roomId).emit("game-started", room);
      } else {
        socket.emit("error", "Need at least 5 players to start");
      }
    });

    socket.on("disconnect", () => {
      rooms.forEach((room, roomId) => {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            if (room.host === socket.id) {
              room.host = room.players[0].id;
            }
            io.to(roomId).emit("room-updated", room);
          }
        }
      });
    });
  });

  
  if (isDev && vite) {
    app.get('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        
        if (url.includes('.') && !url.endsWith('.html')) {
          return next();
        }
        
        
        let template;
        const indexPath = path.join(process.cwd(), 'index.html');
        if (fs.existsSync(indexPath)) {
          template = fs.readFileSync(indexPath, 'utf-8');
        } else {
          template = `
            <!doctype html>
            <html lang="en">
              <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Fruit Mafia AR</title>
              </head>
              <body>
                <div id="root"></div>
                <script type="module" src="/src/main.tsx"></script>
              </body>
            </html>
          `;
        }
        
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else if (!isDev) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
