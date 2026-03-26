import React, { useEffect, useState, useRef, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { FruitFace } from './components/FruitFace';
import { cn } from './lib/utils';
import { 
  User, Users, Play, LogIn, Plus, Shield, Skull, Heart, 
  Search, MessageSquare, Send, Copy, Check, Info, 
  Moon, Sun, Vote, AlertCircle, Trophy, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';

// --- Types ---

type Role = 'mafia' | 'doctor' | 'detective' | 'citizen';
type Phase = 'waiting' | 'night' | 'day_results' | 'day_discussion' | 'voting' | 'elimination' | 'game_over';

interface Player {
  id: string;
  name: string;
  role: Role | null;
  isAlive: boolean;
  fruit: string;
}

interface GameLog {
  message: string;
  type: 'info' | 'danger' | 'success' | 'system';
  timestamp: number;
}

interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

interface Room {
  id: string;
  host: string;
  players: Player[];
  maxPlayers: number;
  status: 'lobby' | 'playing' | 'ended';
  phase: Phase;
  nightActions: {
    mafiaTarget: string | null;
    doctorTarget: string | null;
    detectiveTarget: string | null;
  };
  votes: Record<string, string>; // voterId -> targetId
  logs: GameLog[];
  chat: ChatMessage[];
  detectiveResults: Record<string, 'mafia' | 'citizen'>; // targetId -> role
  lastVotes: Record<string, string>; // voterId -> targetId
  winner: 'mafia' | 'citizens' | null;
}

const FRUITS = ['watermelon', 'apple', 'orange', 'grapefruit', 'pomelo', 'lemon', 'lime', 'guava', 'apricot', 'tangerine'];

// --- Main Component ---

export default function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'logs'>('chat');
  const roomRef = useRef<Room | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.chat]);

  const sendChatMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatInput.trim() || !room || !peerRef.current) return;
    const me = room.players.find(p => p.id === peerRef.current?.id);
    if (!me || !me.isAlive && room.status === 'playing') return;

    const newMessage: ChatMessage = {
      senderId: me.id,
      senderName: me.name,
      text: chatInput.trim(),
      timestamp: Date.now()
    };

    const updatedRoom = {
      ...room,
      chat: [...room.chat, newMessage].slice(-50)
    };
    broadcast(updatedRoom);
    setChatInput('');
  };
  const peerStreamsRef = useRef<Record<string, MediaStream>>({});
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Record<string, DataConnection>>({});

  // Sync refs with state
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { peerStreamsRef.current = peerStreams; }, [peerStreams]);

  // --- PeerJS Logic ---

  const broadcast = (updatedRoom: Room) => {
    setRoom({ ...updatedRoom });
    Object.values(connectionsRef.current).forEach((conn) => {
      const c = conn as DataConnection;
      if (c.open) c.send({ type: 'ROOM_UPDATE', room: updatedRoom });
    });
  };

  const addLog = (message: string, type: GameLog['type'] = 'info') => {
    if (!roomRef.current) return;
    const newLog: GameLog = { message, type, timestamp: Date.now() };
    const updatedRoom = { ...roomRef.current, logs: [newLog, ...roomRef.current.logs].slice(0, 50) };
    broadcast(updatedRoom);
  };

  const startMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      return stream;
    } catch (err) {
      toast.error('Camera/Microphone access denied');
      setError('Camera/Microphone access denied');
      return null;
    }
  };

  const handlePeerConnection = (conn: DataConnection, stream: MediaStream) => {
    conn.on('data', (data: any) => {
      if (data.type === 'JOIN_REQUEST') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        if (currentRoom.players.length >= currentRoom.maxPlayers) {
          conn.send({ type: 'ERROR', message: 'Room is full' });
          return;
        }

        const fruit = FRUITS.find(f => !currentRoom.players.map(p => p.fruit).includes(f)) || 'orange';
        const newPlayer: Player = { id: conn.peer, name: data.playerName, role: null, isAlive: true, fruit };
        const updatedRoom = { 
          ...currentRoom, 
          players: [...currentRoom.players, newPlayer],
          logs: [{ message: `${data.playerName} joined the lobby`, type: 'system', timestamp: Date.now() }, ...currentRoom.logs]
        };
        broadcast(updatedRoom);
      }
      
      if (data.type === 'ROOM_UPDATE') {
        setRoom(data.room);
        // Connect to any new players for media
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

      if (data.type === 'ERROR') {
        toast.error(data.message);
        setError(data.message);
        setIsConnecting(false);
      }
    });
  };

  const createRoom = async () => {
    const trimmedName = playerName.trim();
    if (!trimmedName) return toast.error('Enter your name');
    setIsConnecting(true);
    const stream = await startMedia();
    if (!stream) return setIsConnecting(false);

    const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const peer = new Peer(shortId);
    peerRef.current = peer;

    const randomFruit = FRUITS[Math.floor(Math.random() * FRUITS.length)];

    peer.on('open', (id) => {
      const initialRoom: Room = {
        id: id,
        host: id,
        players: [{ id, name: trimmedName, role: null, isAlive: true, fruit: randomFruit }],
        maxPlayers: 10,
        status: 'lobby',
        phase: 'waiting',
        nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
        votes: {},
        chat: [],
        detectiveResults: {},
        lastVotes: {},
        logs: [{ message: 'Room created. Waiting for players...', type: 'system', timestamp: Date.now() }],
        winner: null
      };
      setRoom(initialRoom);
      setIsConnecting(false);
      toast.success('Room created!');
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

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') createRoom();
      else {
        toast.error('Peer connection error: ' + err.type);
        setIsConnecting(false);
      }
    });
  };

  const joinRoom = async () => {
    const trimmedName = playerName.trim();
    const trimmedRoomId = roomId.trim().toUpperCase();
    if (!trimmedName || !trimmedRoomId) return toast.error('Enter name and room ID');
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
        toast.error('Failed to connect to host');
        setIsConnecting(false);
      });

      handlePeerConnection(conn, stream);

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
      if (err.type === 'peer-unavailable') toast.error('Room not found');
      else toast.error('Peer connection error: ' + err.type);
      setIsConnecting(false);
    });
  };

  // --- Game Logic ---

  const startGame = () => {
    if (!room) return;
    if (room.players.length < 5) return toast.error('Need at least 5 players');

    const shuffled = [...room.players].sort(() => 0.5 - Math.random());
    const mafiaCount = Math.max(1, Math.floor(room.players.length / 4));
    
    const updatedPlayers = room.players.map(p => {
      const index = shuffled.findIndex(s => s.id === p.id);
      let role: Role = 'citizen';
      if (index < mafiaCount) role = 'mafia';
      else if (index === mafiaCount) role = 'doctor';
      else if (index === mafiaCount + 1) role = 'detective';
      return { ...p, role };
    });

    const updatedRoom: Room = {
      ...room,
      status: 'playing',
      phase: 'night',
      players: updatedPlayers,
      nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
      logs: [{ message: 'The game has started! It is now night.', type: 'system', timestamp: Date.now() }, ...room.logs]
    };
    addLog(`Game started with ${room.players.length} players.`, 'system');
    broadcast(updatedRoom);
  };

  const handleNightAction = (targetId: string) => {
    if (!room || !peerRef.current) return;
    const me = room.players.find(p => p.id === peerRef.current?.id);
    if (!me || !me.isAlive) return;

    const updatedActions = { ...room.nightActions };
    if (me.role === 'mafia') {
      updatedActions.mafiaTarget = targetId;
      addLog('Mafia has chosen a target.', 'system');
    }
    if (me.role === 'doctor') {
      updatedActions.doctorTarget = targetId;
      addLog('Doctor has chosen someone to protect.', 'system');
    }
    if (me.role === 'detective') {
      updatedActions.detectiveTarget = targetId;
      const target = room.players.find(p => p.id === targetId);
      toast.info(`${target?.name} is ${target?.role === 'mafia' ? 'MAFIA' : 'NOT MAFIA'}`);
      addLog('Detective has investigated a player.', 'system');
    }

    const updatedRoom = { ...room, nightActions: updatedActions };
    
    // If all roles have acted, move to day results
    const aliveMafia = room.players.some(p => p.role === 'mafia' && p.isAlive);
    const aliveDoctor = room.players.some(p => p.role === 'doctor' && p.isAlive);
    const aliveDetective = room.players.some(p => p.role === 'detective' && p.isAlive);

    const mafiaActed = !aliveMafia || updatedActions.mafiaTarget;
    const doctorActed = !aliveDoctor || updatedActions.doctorTarget;
    const detectiveActed = !aliveDetective || updatedActions.detectiveTarget;

    if (mafiaActed && doctorActed && detectiveActed) {
      resolveNight(updatedRoom);
    } else {
      broadcast(updatedRoom);
    }
  };

  const resolveNight = (currentRoom: Room) => {
    const { mafiaTarget, doctorTarget, detectiveTarget } = currentRoom.nightActions;
    let killedId: string | null = null;
    let logMessage = 'The night was quiet. No one died.';

    if (mafiaTarget && mafiaTarget !== doctorTarget) {
      killedId = mafiaTarget;
      const victim = currentRoom.players.find(p => p.id === killedId);
      logMessage = `${victim?.name} was killed during the night.`;
    } else if (mafiaTarget && mafiaTarget === doctorTarget) {
      logMessage = 'The Mafia tried to kill someone, but the Doctor saved them!';
    }

    const updatedPlayers = currentRoom.players.map(p => 
      p.id === killedId ? { ...p, isAlive: false } : p
    );

    const updatedRoom: Room = {
      ...currentRoom,
      phase: 'day_results',
      players: updatedPlayers,
      logs: [{ message: logMessage, type: killedId ? 'danger' : 'success', timestamp: Date.now() }, ...currentRoom.logs]
    };

    if (detectiveTarget) {
      const target = currentRoom.players.find(p => p.id === detectiveTarget);
      if (target) {
        updatedRoom.detectiveResults = {
          ...currentRoom.detectiveResults,
          [target.id]: target.role === 'mafia' ? 'mafia' : 'citizen'
        };
      }
    }

    if (checkWinConditions(updatedRoom)) return;
    broadcast(updatedRoom);
  };

  const nextPhase = () => {
    if (!room) return;
    let next: Phase = 'waiting';
    if (room.phase === 'day_results') next = 'day_discussion';
    else if (room.phase === 'day_discussion') next = 'voting';
    else if (room.phase === 'voting') resolveVoting();
    else if (room.phase === 'elimination') next = 'night';

    if (next !== 'waiting') {
      const updatedRoom = { 
        ...room, 
        phase: next, 
        votes: {}, 
        nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null } 
      };
      broadcast(updatedRoom);
    }
  };

  const castVote = (targetId: string) => {
    if (!room || !peerRef.current) return;
    const me = room.players.find(p => p.id === peerRef.current?.id);
    if (!me || !me.isAlive) return;

    const updatedVotes = { ...room.votes, [me.id as string]: targetId };
    const updatedRoom = { ...room, votes: updatedVotes };
    
    // If everyone alive has voted, resolve
    const aliveCount = room.players.filter(p => p.isAlive).length;
    if (Object.keys(updatedVotes).length === aliveCount) {
      resolveVoting(updatedRoom);
    } else {
      broadcast(updatedRoom);
    }
  };

  const resolveVoting = (currentRoom = room) => {
    if (!currentRoom) return;
    const voteCounts: Record<string, number> = {};
    Object.values(currentRoom.votes).forEach(id => {
      const targetId = id as string;
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    let eliminatedId: string | null = null;
    let maxVotes = 0;
    let tie = false;

    Object.entries(voteCounts).forEach(([id, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = id;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    });

    let logMessage = 'The town could not reach a consensus. No one was eliminated.';
    if (eliminatedId && !tie) {
      const victim = currentRoom.players.find(p => p.id === eliminatedId);
      logMessage = `${victim?.name} was eliminated by popular vote. They were a ${victim?.role}.`;
    }

    const updatedPlayers = currentRoom.players.map(p => 
      p.id === eliminatedId && !tie ? { ...p, isAlive: false } : p
    );

    const updatedRoom: Room = {
      ...currentRoom,
      phase: 'elimination',
      players: updatedPlayers,
      lastVotes: currentRoom.votes,
      logs: [{ message: logMessage, type: eliminatedId && !tie ? 'danger' : 'info', timestamp: Date.now() }, ...currentRoom.logs]
    };

    if (checkWinConditions(updatedRoom)) return;
    broadcast(updatedRoom);
  };

  const checkWinConditions = (currentRoom: Room) => {
    const aliveMafia = currentRoom.players.filter(p => p.role === 'mafia' && p.isAlive).length;
    const aliveCitizens = currentRoom.players.filter(p => p.role !== 'mafia' && p.isAlive).length;

    if (aliveMafia === 0) {
      const updatedRoom: Room = {
        ...currentRoom,
        status: 'ended',
        phase: 'game_over',
        winner: 'citizens',
        logs: [{ message: 'CITIZENS WIN! All Mafia members have been eliminated.', type: 'success', timestamp: Date.now() }, ...currentRoom.logs]
      };
      broadcast(updatedRoom);
      return true;
    }

    if (aliveMafia >= aliveCitizens) {
      const updatedRoom: Room = {
        ...currentRoom,
        status: 'ended',
        phase: 'game_over',
        winner: 'mafia',
        logs: [{ message: 'MAFIA WINS! They have taken over the town.', type: 'danger', timestamp: Date.now() }, ...currentRoom.logs]
      };
      broadcast(updatedRoom);
      return true;
    }

    return false;
  };

  const copyCode = () => {
    if (room) {
      navigator.clipboard.writeText(room.id);
      setCopied(true);
      toast.success('Code copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // --- Render Helpers ---

  if (!room) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-4 font-sans overflow-hidden relative">
        <Toaster position="top-center" theme="dark" />
        
        {/* Background Atmosphere */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-600/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-zinc-600/10 blur-[120px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md z-10"
        >
          <div className="text-center mb-12">
            <motion.h1 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="text-7xl font-black tracking-tighter uppercase italic text-orange-600 mb-2 leading-none"
            >
              Fruit Mafia
            </motion.h1>
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.4em]">Talking Fruit AR Edition</p>
          </div>

          <div className="bg-zinc-900/40 border border-white/5 backdrop-blur-3xl p-8 rounded-[2.5rem] shadow-2xl space-y-8">
            {!isJoining ? (
              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest font-black text-zinc-500 ml-1">Player Identity</label>
                  <div className="relative group">
                    <User className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 group-focus-within:text-orange-500 transition-colors" />
                    <input
                      type="text"
                      placeholder="YOUR NAME"
                      className="w-full bg-black/40 border border-white/5 rounded-2xl py-5 pl-14 pr-6 focus:outline-none focus:border-orange-500/50 transition-all text-sm font-bold tracking-widest uppercase"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={createRoom}
                    disabled={isConnecting}
                    className="flex flex-col items-center justify-center gap-4 bg-orange-600 hover:bg-orange-500 py-10 rounded-3xl transition-all group disabled:opacity-50 shadow-2xl shadow-orange-900/20 active:scale-95"
                  >
                    <Plus className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Host Game</span>
                  </button>
                  <button
                    onClick={() => setIsJoining(true)}
                    className="flex flex-col items-center justify-center gap-4 bg-white/5 hover:bg-white/10 py-10 rounded-3xl transition-all group border border-white/5 active:scale-95"
                  >
                    <LogIn className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Join Game</span>
                  </button>
                </div>
              </div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8"
              >
                <div className="space-y-3">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] uppercase tracking-widest font-black text-zinc-500">Session Code</label>
                    <button 
                      onClick={() => setIsJoining(false)} 
                      className="text-[10px] uppercase font-black text-zinc-600 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="ENTER CODE"
                    autoFocus
                    className="w-full bg-black/40 border border-white/5 rounded-2xl py-5 px-6 focus:outline-none focus:border-orange-500/50 uppercase text-center tracking-[0.3em] font-mono text-xl font-black"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                  />
                </div>
                <button
                  onClick={joinRoom}
                  disabled={isConnecting || !roomId.trim()}
                  className="w-full bg-white text-black font-black py-6 rounded-2xl uppercase tracking-[0.3em] hover:bg-zinc-200 transition-all shadow-2xl active:scale-95 disabled:opacity-50"
                >
                  {isConnecting ? 'Connecting...' : 'Enter Room'}
                </button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const me = room.players.find(p => p.id === peerRef.current?.id);

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col font-sans overflow-hidden selection:bg-orange-500/30">
      <Toaster position="top-center" theme="dark" richColors />
      
      {/* Night Overlay */}
      <AnimatePresence>
        {room.phase === 'night' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] pointer-events-none bg-indigo-950/20 backdrop-blur-[2px] mix-blend-multiply"
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-black/40 backdrop-blur-2xl sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <h2 className="text-3xl font-black italic tracking-tighter text-orange-600 uppercase">Fruit Mafia</h2>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/5">
            <Users className="w-4 h-4 text-zinc-500" />
            <span className="text-[10px] font-black tracking-[0.2em] uppercase">{room.players.length}/{room.maxPlayers}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/5">
            <span className="text-[10px] font-black tracking-widest uppercase text-zinc-500">Phase:</span>
            <span className="text-[10px] font-black tracking-widest uppercase text-orange-500 italic">{room.phase.replace('_', ' ')}</span>
            {room.phase === 'voting' && (
              <span className="ml-2 px-2 py-0.5 bg-orange-600/20 text-orange-500 text-[8px] font-black rounded border border-orange-500/20">
                {Object.keys(room.votes).length}/{room.players.filter(p => p.isAlive).length} VOTED
              </span>
            )}
          </div>
          
          <button 
            onClick={copyCode}
            className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 transition-all rounded-xl border border-white/5 flex items-center gap-3 group"
          >
            <span className="text-[10px] font-black tracking-widest uppercase text-zinc-500">Room:</span>
            <span className="text-xs font-mono font-black text-white">{room.id}</span>
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-zinc-600 group-hover:text-white" />}
          </button>
          
          <button 
            onClick={() => window.location.reload()}
            className="p-2.5 bg-zinc-900 hover:bg-red-900/40 transition-colors rounded-xl border border-white/5 text-zinc-600 hover:text-red-500"
            title="Leave Room"
          >
            <LogIn className="w-5 h-5 rotate-180" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-8 flex gap-8 overflow-hidden">
        {/* Game Grid */}
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 overflow-y-auto pr-4 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {room.players.map(player => (
              <motion.div 
                layout
                key={player.id} 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  "relative group rounded-3xl overflow-hidden border-2 transition-all duration-500",
                  player.isAlive ? "border-white/5 shadow-xl" : "border-red-900/50 grayscale opacity-60",
                  room.phase === 'night' && me?.role === 'mafia' && player.role === 'mafia' && "border-orange-500/50 shadow-[0_0_20px_rgba(249,115,22,0.2)]"
                )}
              >
                <FruitFace
                  stream={player.id === peerRef.current?.id ? localStream : peerStreams[player.id]}
                  fruitType={player.fruit}
                  isLocal={player.id === peerRef.current?.id}
                  playerName={player.name}
                  status={
                    room.phase === 'night' && me?.role === 'mafia' && room.nightActions.mafiaTarget === player.id ? 'targeted' :
                    room.phase === 'night' && me?.role === 'doctor' && room.nightActions.doctorTarget === player.id ? 'protected' :
                    me?.role === 'detective' && room.detectiveResults[player.id] === 'mafia' ? 'investigated_mafia' :
                    me?.role === 'detective' && room.detectiveResults[player.id] === 'citizen' ? 'investigated_citizen' :
                    null
                  }
                />
                
                {/* Player Info Overlay */}
                <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none">
                  <div className="px-3 py-1 bg-black/60 backdrop-blur-md rounded-lg border border-white/5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white">{player.name}</p>
                  </div>
                  
                  {room.status === 'playing' && player.id === peerRef.current?.id && (
                    <div className="px-3 py-1 bg-orange-600 rounded-lg shadow-lg">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white italic">{player.role}</p>
                    </div>
                  )}
                </div>

                {/* Dead Overlay */}
                {!player.isAlive && (
                  <div className="absolute inset-0 bg-red-950/40 flex flex-col items-center justify-center backdrop-blur-[2px]">
                    <Skull className="w-16 h-16 text-red-600 mb-2 drop-shadow-2xl" />
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500">Eliminated</p>
                  </div>
                )}

                {/* Voting Results Overlay */}
                {room.phase === 'elimination' && (
                  <div className="absolute bottom-12 left-4 right-4 flex flex-wrap gap-1">
                    {Object.entries(room.lastVotes)
                      .filter(([_, targetId]) => targetId === player.id)
                      .map(([voterId]) => {
                        const voter = room.players.find(p => p.id === voterId);
                        return (
                          <div key={voterId} className="px-2 py-0.5 bg-black/60 backdrop-blur-md rounded border border-white/10 text-[8px] font-black uppercase text-zinc-400">
                            {voter?.name}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Action Button Overlay */}
                {room.status === 'playing' && me?.isAlive && player.isAlive && player.id !== me.id && (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-6">
                    {room.phase === 'night' && (
                      <>
                        {me.role === 'mafia' && (
                          <button 
                            onClick={() => handleNightAction(player.id)}
                            className="w-full py-4 bg-red-600 hover:bg-red-500 rounded-2xl font-black uppercase text-xs tracking-widest shadow-2xl active:scale-95"
                          >
                            Eliminate
                          </button>
                        )}
                        {me.role === 'doctor' && (
                          <button 
                            onClick={() => handleNightAction(player.id)}
                            className="w-full py-4 bg-green-600 hover:bg-green-500 rounded-2xl font-black uppercase text-xs tracking-widest shadow-2xl active:scale-95"
                          >
                            Protect
                          </button>
                        )}
                        {me.role === 'detective' && (
                          <button 
                            onClick={() => handleNightAction(player.id)}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black uppercase text-xs tracking-widest shadow-2xl active:scale-95"
                          >
                            Investigate
                          </button>
                        )}
                      </>
                    )}
            {room.phase === 'voting' && me && (
              <button 
                onClick={() => castVote(player.id)}
                className={cn(
                  "w-full py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-2xl active:scale-95",
                  room.votes[me.id] === player.id ? "bg-orange-600 text-white" : "bg-white text-black hover:bg-zinc-200"
                )}
              >
                {room.votes[me.id] === player.id ? 'Voted' : 'Cast Vote'}
              </button>
            )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Sidebar */}
        <aside className="w-96 flex flex-col gap-6">
          {/* Game Control Card */}
          <div className="bg-zinc-900/40 border border-white/5 backdrop-blur-3xl rounded-[2rem] p-8 space-y-8 shadow-2xl relative overflow-hidden">
            {/* Animated Background for Phase */}
            <AnimatePresence mode="wait">
              <motion.div 
                key={room.phase}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.05 }}
                exit={{ opacity: 0 }}
                className={cn(
                  "absolute inset-0 pointer-events-none",
                  room.phase === 'night' ? "bg-indigo-500" : "bg-orange-500"
                )}
              />
            </AnimatePresence>

            <div className="space-y-2 relative z-10">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Current Status</h3>
              <div className="flex items-center gap-3">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={room.phase}
                    initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.5, opacity: 0, rotate: 20 }}
                  >
                    {room.phase === 'night' ? <Moon className="w-6 h-6 text-indigo-400" /> : <Sun className="w-6 h-6 text-orange-400" />}
                  </motion.div>
                </AnimatePresence>
                <p className="text-2xl font-black uppercase italic tracking-tight">
                  {room.status === 'lobby' ? 'Waiting Room' : room.phase.replace('_', ' ')}
                </p>
              </div>
            </div>

            {room.status === 'lobby' && room.host === peerRef.current?.id && (
              <div className="space-y-2 relative z-10">
                <button
                  onClick={startGame}
                  disabled={room.players.length < 5}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-orange-900/20 active:scale-95 disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span className="uppercase tracking-[0.2em] text-xs">
                    {room.players.length < 5 ? `Need ${5 - room.players.length} more` : 'Start Session'}
                  </span>
                </button>
                {room.players.length < 5 && (
                  <p className="text-[9px] text-center font-black uppercase tracking-widest text-zinc-600">
                    Minimum 5 players required to start
                  </p>
                )}
              </div>
            )}

            {room.status === 'playing' && room.host === peerRef.current?.id && (
              <button
                onClick={nextPhase}
                className="w-full bg-white text-black font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95 relative z-10"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="uppercase tracking-[0.2em] text-xs">Next Phase</span>
              </button>
            )}

            {room.status === 'playing' && me?.isAlive && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4 relative z-10"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-orange-600/20 flex items-center justify-center border border-orange-500/20">
                    {me.role === 'mafia' ? <Skull className="w-6 h-6 text-orange-500" /> : 
                     me.role === 'doctor' ? <Heart className="w-6 h-6 text-orange-500" /> :
                     me.role === 'detective' ? <Search className="w-6 h-6 text-orange-500" /> :
                     <User className="w-6 h-6 text-orange-500" />}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Your Role</p>
                    <p className="text-xl font-black uppercase tracking-widest text-orange-500 italic leading-none">{me.role}</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-white/5">
                  <p className="text-[9px] font-bold text-zinc-500 leading-relaxed uppercase tracking-wider">
                    {me.role === 'mafia' ? 'Coordinate with other Mafia members to eliminate citizens each night.' :
                     me.role === 'doctor' ? 'Choose one player to protect each night. You can save them from the Mafia.' :
                     me.role === 'detective' ? 'Investigate one player each night to discover if they are Mafia.' :
                     'Work with other citizens to find and eliminate the Mafia during the day.'}
                  </p>
                </div>
              </motion.div>
            )}

            {room.phase === 'game_over' && (
              <div className={cn(
                "p-8 rounded-3xl border text-center space-y-4 relative z-10",
                room.winner === 'citizens' ? "bg-green-600/10 border-green-500/20" : "bg-red-600/10 border-red-500/20"
              )}>
                <Trophy className={cn("w-12 h-12 mx-auto", room.winner === 'citizens' ? "text-green-500" : "text-red-500")} />
                <div>
                  <h4 className="text-2xl font-black uppercase italic tracking-tighter">
                    {room.winner === 'citizens' ? 'Citizens Win!' : 'Mafia Wins!'}
                  </h4>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-1">The game has concluded</p>
                </div>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full py-4 bg-white text-black font-black rounded-2xl uppercase text-[10px] tracking-widest active:scale-95"
                >
                  Play Again
                </button>
              </div>
            )}
          </div>

          {/* Chat & Logs Tabs */}
          <div className="flex-1 bg-zinc-900/40 border border-white/5 backdrop-blur-3xl rounded-[2rem] flex flex-col overflow-hidden shadow-2xl min-h-0">
            <div className="flex border-b border-white/5">
              <button 
                onClick={() => setActiveTab('chat')}
                className={cn(
                  "flex-1 p-4 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all",
                  activeTab === 'chat' ? "border-orange-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
                )}
              >
                Chat
              </button>
              <button 
                onClick={() => setActiveTab('logs')}
                className={cn(
                  "flex-1 p-4 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all",
                  activeTab === 'logs' ? "border-orange-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
                )}
              >
                Logs
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {activeTab === 'chat' ? (
                <div className="space-y-4">
                  {room.chat.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-2 opacity-50 py-20">
                      <MessageSquare className="w-8 h-8" />
                      <p className="text-[10px] font-black uppercase tracking-widest">No messages yet</p>
                    </div>
                  )}
                  {room.chat.map((msg, i) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.timestamp + i}
                      className={cn(
                        "flex flex-col gap-1",
                        msg.senderId === peerRef.current?.id ? "items-end" : "items-start"
                      )}
                    >
                      <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500 px-1">
                        {msg.senderName}
                      </span>
                      <div className={cn(
                        "px-4 py-2 rounded-2xl text-xs font-medium max-w-[85%]",
                        msg.senderId === peerRef.current?.id 
                          ? "bg-orange-600 text-white rounded-tr-none" 
                          : "bg-white/5 border border-white/5 text-zinc-200 rounded-tl-none"
                      )}>
                        {msg.text}
                      </div>
                    </motion.div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              ) : (
                <div className="space-y-3">
                  {room.logs.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-2 opacity-50 py-20">
                      <Info className="w-8 h-8" />
                      <p className="text-[10px] font-black uppercase tracking-widest">No logs yet</p>
                    </div>
                  )}
                  {room.logs.map((log, i) => (
                    <motion.div
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={log.timestamp + i}
                      className={cn(
                        "p-3 rounded-xl border text-[10px] font-bold leading-relaxed uppercase tracking-wider",
                        log.type === 'danger' ? "bg-red-500/10 border-red-500/20 text-red-400" :
                        log.type === 'success' ? "bg-green-500/10 border-green-500/20 text-green-400" :
                        log.type === 'system' ? "bg-orange-500/10 border-orange-500/20 text-orange-400" :
                        "bg-white/5 border-white/5 text-zinc-400"
                      )}
                    >
                      {log.message}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Chat Input */}
            {activeTab === 'chat' && (room.status !== 'playing' || (me?.isAlive || room.phase === 'game_over')) && (
              <form onSubmit={sendChatMessage} className="p-4 bg-black/20 border-t border-white/5 flex gap-2">
                <input 
                  type="text"
                  placeholder="TYPE MESSAGE..."
                  className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-orange-500/50 transition-all uppercase font-bold tracking-wider"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button 
                  type="submit"
                  className="p-3 bg-orange-600 hover:bg-orange-500 rounded-xl transition-all active:scale-95"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </form>
            )}
          </div>
        </aside>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}
