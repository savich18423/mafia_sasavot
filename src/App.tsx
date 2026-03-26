import React, { useEffect, useState, useRef } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { FruitFace } from './components/FruitFace';
import { cn } from './lib/utils';
import { User, Users, Play, LogIn, Plus, Shield, Skull, Heart, Search, MessageSquare, Send, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Player {
  id: string; // Peer ID
  name: string;
  role: 'mafia' | 'doctor' | 'detective' | 'citizen' | null;
  isAlive: boolean;
  fruit: string;
}

interface Room {
  id: string; // Host's Peer ID
  host: string;
  players: Player[];
  maxPlayers: number;
  status: 'lobby' | 'playing' | 'ended';
  gameData: {
    phase: 'waiting' | 'day' | 'night' | 'voting';
    votes: Record<string, string>;
    logs: string[];
  };
}

const FRUITS = ['orange', 'apple', 'banana', 'strawberry', 'pear', 'grape', 'lemon', 'watermelon', 'pineapple', 'cherry'];

export default function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const roomRef = useRef<Room | null>(null);
  const peerStreamsRef = useRef<Record<string, MediaStream>>({});
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Record<string, DataConnection>>({});

  // Sync refs with state
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { peerStreamsRef.current = peerStreams; }, [peerStreams]);

  const broadcast = (updatedRoom: Room) => {
    setRoom({ ...updatedRoom });
    Object.values(connectionsRef.current).forEach((conn) => {
      const dataConn = conn as DataConnection;
      if (dataConn.open) dataConn.send({ type: 'ROOM_UPDATE', room: updatedRoom });
    });
  };

  const startMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      return stream;
    } catch (err) {
      setError('Camera/Microphone access denied');
      return null;
    }
  };

  const handlePeerConnection = (conn: DataConnection, stream: MediaStream) => {
    conn.on('data', (data: any) => {
      if (data.type === 'JOIN_REQUEST') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        const fruit = FRUITS.find(f => !currentRoom.players.map(p => p.fruit).includes(f)) || 'orange';
        const newPlayer: Player = { id: conn.peer, name: data.playerName, role: null, isAlive: true, fruit };
        const updatedRoom = { ...currentRoom, players: [...currentRoom.players, newPlayer] };
        broadcast(updatedRoom);
      }
      if (data.type === 'ROOM_UPDATE') {
        setRoom(data.room);
        // Connect to any new players we don't have streams for
        data.room.players.forEach((p: Player) => {
          if (p.id !== peerRef.current?.id && !peerStreamsRef.current[p.id] && !connectionsRef.current[p.id]) {
            const newConn = peerRef.current!.connect(p.id);
            connectionsRef.current[p.id] = newConn;
            handlePeerConnection(newConn, stream);
            const call = peerRef.current!.call(p.id, stream);
            call.on('stream', (remoteStream) => {
              setPeerStreams(prev => ({ ...prev, [p.id]: remoteStream }));
            });
          }
        });
      }
    });
  };

  const createRoom = async () => {
    const trimmedName = playerName.trim();
    if (!trimmedName) return setError('Enter your name');
    setIsConnecting(true);
    const stream = await startMedia();
    if (!stream) return setIsConnecting(false);

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      const initialRoom: Room = {
        id: id,
        host: id,
        players: [{ id, name: trimmedName, role: null, isAlive: true, fruit: 'orange' }],
        maxPlayers: 10,
        status: 'lobby',
        gameData: { phase: 'waiting', votes: {}, logs: ['Room created. Waiting for players...'] }
      };
      setRoom(initialRoom);
      setIsConnecting(false);
    });

    peer.on('connection', (conn) => {
      connectionsRef.current[conn.peer] = conn;
      handlePeerConnection(conn, stream);
    });

    peer.on('call', (call) => {
      call.answer(stream);
      call.on('stream', (remoteStream) => {
        setPeerStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
      });
    });
  };

  const joinRoom = async () => {
    const trimmedName = playerName.trim();
    const trimmedRoomId = roomId.trim();
    if (!trimmedName || !trimmedRoomId) return setError('Enter name and room ID');
    setIsConnecting(true);
    const stream = await startMedia();
    if (!stream) return setIsConnecting(false);

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      const conn = peer.connect(trimmedRoomId);
      connectionsRef.current[trimmedRoomId] = conn;
      
      conn.on('open', () => {
        conn.send({ type: 'JOIN_REQUEST', playerName: trimmedName });
      });

      conn.on('error', (err) => {
        setError('Failed to connect to host. Check the code.');
        setIsConnecting(false);
      });

      handlePeerConnection(conn, stream);

      // Call the host
      const call = peer.call(trimmedRoomId, stream);
      call.on('stream', (remoteStream) => {
        setPeerStreams(prev => ({ ...prev, [trimmedRoomId]: remoteStream }));
        setIsConnecting(false);
      });
    });

    peer.on('call', (call) => {
      call.answer(stream);
      call.on('stream', (remoteStream) => {
        setPeerStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
      });
    });

    peer.on('error', (err) => {
      setError('Peer connection error: ' + err.type);
      setIsConnecting(false);
    });
  };

  const startGame = () => {
    if (!room) return;
    const mafiaCount = Math.floor(room.players.length / 3);
    const shuffled = [...room.players].sort(() => 0.5 - Math.random());
    
    const updatedPlayers = room.players.map(p => {
      const index = shuffled.findIndex(s => s.id === p.id);
      let role: Player['role'] = 'citizen';
      if (index < mafiaCount) role = 'mafia';
      else if (index === mafiaCount) role = 'doctor';
      else if (index === mafiaCount + 1) role = 'detective';
      return { ...p, role };
    });

    const updatedRoom: Room = {
      ...room,
      status: 'playing',
      players: updatedPlayers,
      gameData: { ...room.gameData, phase: 'night', logs: [...room.gameData.logs, 'The game has started! It is now night.'] }
    };
    broadcast(updatedRoom);
  };

  const copyCode = () => {
    if (room) {
      navigator.clipboard.writeText(room.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!room) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8 bg-zinc-900/50 p-8 rounded-3xl border border-zinc-800 backdrop-blur-2xl shadow-2xl"
        >
          <div className="text-center space-y-2">
            <h1 className="text-6xl font-black tracking-tighter uppercase italic text-orange-500 drop-shadow-lg">Fruit Mafia</h1>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.3em]">Talking Fruit AR Edition</p>
          </div>

          <div className="space-y-6">
            {!isJoining ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-black text-zinc-600 ml-1">Player Identity</label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-orange-500 transition-colors" />
                    <input
                      type="text"
                      placeholder="Enter your name..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all text-sm font-medium"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={createRoom}
                    disabled={isConnecting}
                    className="flex flex-col items-center justify-center gap-3 bg-orange-600 hover:bg-orange-500 py-8 rounded-3xl transition-all group disabled:opacity-50 shadow-lg shadow-orange-900/20"
                  >
                    <Plus className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Host Game</span>
                  </button>
                  <button
                    onClick={() => setIsJoining(true)}
                    className="flex flex-col items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 py-8 rounded-3xl transition-all group border border-zinc-700"
                  >
                    <LogIn className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Join Game</span>
                  </button>
                </div>
              </div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] uppercase tracking-widest font-black text-zinc-600">Session Code</label>
                    <button 
                      onClick={() => setIsJoining(false)} 
                      className="text-[10px] uppercase font-black text-zinc-500 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="PASTE CODE HERE"
                    autoFocus
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-4 px-6 focus:outline-none focus:ring-2 focus:ring-orange-500/30 uppercase text-center tracking-[0.2em] font-mono text-lg"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                  />
                </div>
                <button
                  onClick={joinRoom}
                  disabled={isConnecting || !roomId.trim()}
                  className="w-full bg-white text-black font-black py-5 rounded-2xl uppercase tracking-[0.2em] hover:bg-zinc-200 transition-all shadow-xl disabled:opacity-50"
                >
                  {isConnecting ? 'Connecting...' : 'Enter Room'}
                </button>
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl"
              >
                <p className="text-red-500 text-center text-[10px] font-black uppercase tracking-widest">{error}</p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const me = room.players.find(p => p.id === peerRef.current?.id);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-zinc-900 flex items-center justify-between px-6 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-black italic tracking-tighter text-orange-500 uppercase">Fruit Mafia</h2>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2 text-zinc-500">
            <Users className="w-4 h-4" />
            <span className="text-xs font-bold tracking-widest uppercase">{room.players.length}/{room.maxPlayers}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={copyCode}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 transition-all rounded-xl border border-orange-400/30 flex items-center gap-2 group shadow-lg shadow-orange-900/20"
          >
            <span className="text-[10px] font-black tracking-widest uppercase text-white/80">Room Code:</span>
            <span className="text-sm font-mono font-black text-white">{room.id.substring(0, 8).toUpperCase()}</span>
            {copied ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4 text-white/60 group-hover:text-white" />}
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="p-2 bg-zinc-900 hover:bg-red-900/40 transition-colors rounded-xl border border-zinc-800 text-zinc-500 hover:text-red-500"
            title="Leave Room"
          >
            <LogIn className="w-5 h-5 rotate-180" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 flex gap-6 overflow-hidden">
        {/* Game Grid */}
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pr-2">
          {room.players.map(player => (
            <div key={player.id} className="relative group">
              <FruitFace
                stream={player.id === peerRef.current?.id ? localStream : peerStreams[player.id]}
                fruitType={player.fruit}
                isLocal={player.id === peerRef.current?.id}
                playerName={player.name}
              />
              {!player.isAlive && (
                <div className="absolute inset-0 bg-red-950/60 flex items-center justify-center backdrop-blur-[2px] rounded-lg">
                  <Skull className="w-12 h-12 text-red-500" />
                </div>
              )}
              {room.status === 'playing' && player.id === peerRef.current?.id && (
                <div className="absolute top-2 right-2 px-2 py-1 bg-orange-600 rounded text-[10px] font-black uppercase tracking-widest">
                  {player.role}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <aside className="w-80 flex flex-col gap-4">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 space-y-6">
            <div className="space-y-1">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Game Status</h3>
              <p className="text-xl font-black uppercase italic">
                {room.status === 'lobby' ? 'Waiting for Players' : `Phase: ${room.gameData.phase}`}
              </p>
            </div>

            {room.status === 'lobby' && room.host === peerRef.current?.id && (
              <button
                onClick={startGame}
                disabled={room.players.length < 2}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span className="uppercase tracking-widest text-xs">Start Session</span>
              </button>
            )}

              {room.status === 'playing' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-zinc-950 rounded-2xl border border-zinc-800 shadow-inner">
                    <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                      {me?.role === 'mafia' ? <Skull className="w-6 h-6 text-orange-500" /> : <Shield className="w-6 h-6 text-orange-500" />}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Your Secret Role</p>
                      <p className="text-lg font-black uppercase tracking-widest text-orange-500 italic">{me?.role}</p>
                    </div>
                  </div>

                  {room.gameData.phase === 'voting' && me?.isAlive && (
                    <div className="p-4 bg-orange-600/10 border border-orange-500/20 rounded-2xl space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-orange-500 text-center">Cast Your Vote</p>
                      <div className="grid grid-cols-1 gap-2">
                        {room.players.filter(p => p.isAlive && p.id !== me.id).map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              const updatedVotes = { ...room.gameData.votes, [me.id]: p.id };
                              const updatedRoom = { ...room, gameData: { ...room.gameData, votes: updatedVotes } };
                              broadcast(updatedRoom);
                            }}
                            className={cn(
                              "w-full py-2 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                              room.gameData.votes[me.id] === p.id 
                                ? "bg-orange-600 border-orange-400 text-white" 
                                : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-orange-500/50"
                            )}
                          >
                            Vote for {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>

          <div className="flex-1 bg-zinc-900 rounded-2xl border border-zinc-800 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Activity Log</h3>
              <MessageSquare className="w-3 h-3 text-zinc-600" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {room.gameData.logs.map((log, i) => (
                <div key={i} className="text-[11px] leading-relaxed text-zinc-400 border-l-2 border-zinc-800 pl-3">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

