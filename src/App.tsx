import React, { useEffect, useState, useRef, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { FruitFace } from './components/FruitFace';
import { cn } from './lib/utils';
import { 
  User, Users, Play, LogIn, Plus, Shield, Skull, Heart, 
  Search, MessageSquare, Send, Copy, Check, Info, 
  Moon, Sun, Vote, AlertCircle, Trophy, RefreshCw, LogOut
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

const ROLE_NAMES: Record<Role, string> = {
  mafia: 'Мафия',
  doctor: 'Доктор',
  detective: 'Детектив',
  citizen: 'Житель'
};

const PHASE_NAMES: Record<Phase, string> = {
  waiting: 'Ожидание',
  night: 'Ночь',
  day_results: 'Итоги ночи',
  day_discussion: 'Обсуждение',
  voting: 'Голосование',
  elimination: 'Исключение',
  game_over: 'Конец игры'
};

const STATUS_NAMES: Record<string, string> = {
  lobby: 'В лобби',
  playing: 'В игре',
  ended: 'Завершена'
};

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
  const [showHowToPlay, setShowHowToPlay] = useState(false);
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
      toast.error('Доступ к камере/микрофону запрещен');
      setError('Доступ к камере/микрофону запрещен');
      return null;
    }
  };

  const handlePeerConnection = (conn: DataConnection, stream: MediaStream) => {
    conn.on('data', (data: any) => {
      if (data.type === 'JOIN_REQUEST') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        if (currentRoom.players.length >= currentRoom.maxPlayers) {
          conn.send({ type: 'ERROR', message: 'Комната заполнена' });
          return;
        }

        const fruit = FRUITS.find(f => !currentRoom.players.map(p => p.fruit).includes(f)) || 'orange';
        const newPlayer: Player = { id: conn.peer, name: data.playerName, role: null, isAlive: true, fruit };
        const updatedRoom = { 
          ...currentRoom, 
          players: [...currentRoom.players, newPlayer],
          logs: [{ message: `${data.playerName} зашел в лобби`, type: 'system', timestamp: Date.now() }, ...currentRoom.logs]
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
    if (!trimmedName) return toast.error('Введите ваше имя');
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
        logs: [{ message: 'Комната создана. Ожидание игроков...', type: 'system', timestamp: Date.now() }],
        winner: null
      };
      setRoom(initialRoom);
      setIsConnecting(false);
      toast.success('Комната создана!');
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
        toast.error('Ошибка подключения: ' + err.type);
        setIsConnecting(false);
      }
    });
  };

  const joinRoom = async () => {
    const trimmedName = playerName.trim();
    const trimmedRoomId = roomId.trim().toUpperCase();
    if (!trimmedName || !trimmedRoomId) return toast.error('Введите имя и ID комнаты');
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
        toast.error('Не удалось подключиться к хосту');
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
      if (err.type === 'peer-unavailable') toast.error('Комната не найдена');
      else toast.error('Ошибка подключения: ' + err.type);
      setIsConnecting(false);
    });
  };

  // --- Game Logic ---

  const startGame = () => {
    if (!room) return;
    if (room.players.length < 5) return toast.error('Нужно минимум 5 игроков');

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
      logs: [
        { message: `Игра началась. Игроков: ${room.players.length}.`, type: 'system', timestamp: Date.now() },
        { message: 'Игра началась! Наступила ночь.', type: 'system', timestamp: Date.now() + 1 },
        ...room.logs
      ]
    };
    broadcast(updatedRoom);
  };

  const handleNightAction = (targetId: string) => {
    if (!room || !peerRef.current) return;
    const me = room.players.find(p => p.id === peerRef.current?.id);
    if (!me || !me.isAlive) return;

    const updatedActions = { ...room.nightActions };
    if (me.role === 'mafia') {
      updatedActions.mafiaTarget = targetId;
      const target = room.players.find(p => p.id === targetId);
      addLog(`Мафия выбрала цель: ${target?.name}.`, 'system');
    }
    if (me.role === 'doctor') {
      updatedActions.doctorTarget = targetId;
      const target = room.players.find(p => p.id === targetId);
      addLog(`Доктор решил защитить: ${target?.name}.`, 'system');
    }
    if (me.role === 'detective') {
      updatedActions.detectiveTarget = targetId;
      const target = room.players.find(p => p.id === targetId);
      toast.info(`${target?.name} — ${target?.role === 'mafia' ? 'МАФИЯ' : 'НЕ МАФИЯ'}`);
      addLog(`Детектив проверил: ${target?.name}.`, 'system');
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
    let logMessage = 'Ночь прошла спокойно. Никто не погиб.';

    if (mafiaTarget && mafiaTarget !== doctorTarget) {
      killedId = mafiaTarget;
      const victim = currentRoom.players.find(p => p.id === killedId);
      logMessage = `${victim?.name} был убит этой ночью.`;
    } else if (mafiaTarget && mafiaTarget === doctorTarget) {
      logMessage = 'Мафия пыталась совершить убийство, но Доктор спас жертву!';
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
    else if (room.phase === 'voting') {
      resolveVoting();
      return;
    }
    else if (room.phase === 'elimination') next = 'night';

    if (next !== 'waiting') {
      const updatedRoom: Room = { 
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
    const target = room.players.find(p => p.id === targetId);
    const updatedRoom = { 
      ...room, 
      votes: updatedVotes,
      logs: [{ message: `${me.name} проголосовал.`, type: 'info', timestamp: Date.now() }, ...room.logs]
    };
    
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

    let logMessage = 'Город не пришел к согласию. Никто не исключен.';
    if (eliminatedId && !tie) {
      const victim = currentRoom.players.find(p => p.id === eliminatedId);
      const roleMap: Record<string, string> = { 'mafia': 'Мафией', 'doctor': 'Доктором', 'detective': 'Детективом', 'citizen': 'Мирным жителем' };
      logMessage = `${victim?.name} был исключен голосованием. Он был ${roleMap[victim?.role || 'citizen']}.`;
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
        logs: [{ message: 'МИРНЫЕ ПОБЕДИЛИ! Вся мафия устранена.', type: 'success', timestamp: Date.now() }, ...currentRoom.logs]
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
        logs: [{ message: 'МАФИЯ ПОБЕДИЛА! Город захвачен.', type: 'danger', timestamp: Date.now() }, ...currentRoom.logs]
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
      toast.success('Код скопирован');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // --- Render Helpers ---

  if (!room) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-4 font-sans overflow-hidden relative selection:bg-orange-500/30">
        <Toaster position="top-center" theme="dark" richColors />
        
        {/* Background Atmosphere - Recipe 7 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[80%] h-[80%] bg-orange-600/10 blur-[180px] rounded-full animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[80%] h-[80%] bg-indigo-600/10 blur-[180px] rounded-full animate-pulse" style={{ animationDelay: '3s' }} />
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.05] mix-blend-overlay" />
          
          {/* Floating Particles */}
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: Math.random() * 1000 }}
              animate={{ 
                opacity: [0, 0.5, 0], 
                y: [Math.random() * 1000, Math.random() * 1000 - 500],
                x: [Math.random() * 1000, Math.random() * 1000 + 100]
              }}
              transition={{ duration: 10 + Math.random() * 20, repeat: Infinity, ease: "linear" }}
              className="absolute w-1 h-1 bg-white/20 rounded-full"
            />
          ))}
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.23, 1, 0.32, 1] }}
          className="w-full max-w-7xl grid lg:grid-cols-2 gap-20 items-center z-10"
        >
          {/* Left Side: Editorial Branding - Recipe 2 */}
          <div className="space-y-16">
            <div className="space-y-8">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-orange-600/10 border border-orange-600/20 text-orange-500 text-[11px] font-black uppercase tracking-[0.3em]"
              >
                <div className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
                AR игра на выживание в реальном времени
              </motion.div>
              
              <div className="relative">
                <motion.h1 
                  initial={{ scale: 0.8, opacity: 0, rotateX: 45 }}
                  animate={{ scale: 1, opacity: 1, rotateX: 0 }}
                  transition={{ delay: 0.4, type: "spring", stiffness: 50 }}
                  className="text-[12vw] lg:text-[10rem] font-black tracking-tighter uppercase italic text-white leading-[0.8] mix-blend-difference"
                >
                  Фруктовая <br />
                  <span className="text-orange-600">Мафия</span>
                </motion.h1>
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ delay: 1, duration: 1.5, ease: "circOut" }}
                  className="h-1 bg-gradient-to-r from-orange-600 to-transparent mt-4"
                />
              </div>

              <p className="text-zinc-400 text-xl max-w-lg font-medium leading-relaxed">
                Разоблачите предателей, скрывающихся за анимированными говорящими фруктами. Игра на выживание, где на кону доверие и хитрость.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-10">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-px bg-zinc-800" />
                    <h3 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-500">Руководство</h3>
                  </div>
                  <button 
                    onClick={() => setShowHowToPlay(true)}
                    className="text-[10px] font-black uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors flex items-center gap-2 group"
                  >
                    Полный гайд
                    <Info className="w-3 h-3 group-hover:rotate-12 transition-transform" />
                  </button>
                </div>
                <ul className="space-y-6">
                  {[
                    { icon: <Users className="w-4 h-4" />, title: "Лобби", text: "Соберите 5-10 игроков для начала" },
                    { icon: <Shield className="w-4 h-4" />, title: "Роли", text: "Секретные роли выдаются на старте" },
                    { icon: <Moon className="w-4 h-4" />, title: "Ночь", text: "Мафия атакует, Доктор лечит" },
                    { icon: <Sun className="w-4 h-4" />, title: "День", text: "Обсуждайте и голосуйте, чтобы выжить" },
                  ].map((item, i) => (
                    <motion.li 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                      className="flex items-start gap-4 group cursor-help"
                    >
                      <div className="mt-1 p-2 rounded-xl bg-white/5 text-orange-500 border border-white/5 group-hover:bg-orange-600 group-hover:text-white transition-all duration-500">
                        {item.icon}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-widest text-white group-hover:text-orange-500 transition-colors">{item.title}</p>
                        <p className="text-sm text-zinc-500 leading-tight">{item.text}</p>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-px bg-zinc-800" />
                  <h3 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-500">Роли</h3>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { name: 'Мафия', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', desc: 'Устраните всех жителей' },
                    { name: 'Доктор', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', desc: 'Защищайте одного игрока ночью' },
                    { name: 'Детектив', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', desc: 'Проверяйте одного игрока ночью' },
                    { name: 'Житель', color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20', desc: 'Найдите и выгоните Мафию' },
                  ].map((role, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.8 + i * 0.1 }}
                      className={`px-4 py-3 rounded-2xl border flex items-center justify-between group hover:scale-[1.02] transition-all duration-300 ${role.bg} ${role.border}`}
                    >
                      <div className="space-y-0.5">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${role.color}`}>{role.name}</span>
                        <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">{role.desc}</p>
                      </div>
                      <div className={`w-1.5 h-1.5 rounded-full ${role.color.replace('text', 'bg')} opacity-40 group-hover:opacity-100 transition-opacity`} />
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Auth Form - Hardware/Glassmorphism - Recipe 3/7 */}
          <div className="relative">
            {/* Decorative Glow */}
            <div className="absolute -inset-4 bg-orange-600/20 blur-[100px] rounded-full opacity-50 animate-pulse" />
            
            <div className="bg-zinc-900/40 border border-white/10 backdrop-blur-3xl p-12 rounded-[4rem] shadow-[0_40px_100px_rgba(0,0,0,0.5)] relative overflow-hidden ring-1 ring-white/5">
              <div className="absolute top-0 right-0 w-64 h-64 bg-orange-600/10 blur-[100px] rounded-full -mr-32 -mt-32" />
              
              {!isJoining ? (
                <div className="space-y-12 relative z-10">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <label className="text-[10px] uppercase tracking-[0.5em] font-black text-zinc-500">Личность игрока</label>
                      <div className="flex gap-1">
                        {[...Array(3)].map((_, i) => <div key={i} className="w-1 h-1 rounded-full bg-orange-600/40" />)}
                      </div>
                    </div>
                    <div className="relative group">
                      <div className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center group-focus-within:bg-orange-500/20 group-focus-within:rotate-12 transition-all duration-500">
                        <User className="w-5 h-5 text-zinc-500 group-focus-within:text-orange-500 transition-colors" />
                      </div>
                      <input
                        type="text"
                        placeholder="ВВЕДИТЕ ВАШЕ ИМЯ"
                        className="w-full bg-black/60 border border-white/10 rounded-[2rem] py-8 pl-20 pr-8 focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all text-base font-black tracking-[0.2em] uppercase placeholder:text-zinc-800 text-white"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-6">
                    <motion.button
                      whileHover={{ scale: 1.02, y: -4 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={createRoom}
                      disabled={isConnecting || !playerName.trim()}
                      className="flex items-center justify-between px-10 py-10 bg-orange-600 hover:bg-orange-500 rounded-[2.5rem] transition-all group disabled:opacity-50 shadow-[0_20px_50px_rgba(234,88,12,0.4)] relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex flex-col items-start gap-2 relative z-10">
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-70">Создать сессию</span>
                        <span className="text-3xl font-black uppercase italic tracking-tighter">Создать игру</span>
                      </div>
                      <div className="w-16 h-16 rounded-3xl bg-white/10 flex items-center justify-center group-hover:bg-white/20 group-hover:rotate-90 transition-all duration-500 relative z-10">
                        <Plus className="w-8 h-8" />
                      </div>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02, y: -4 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setIsJoining(true)}
                      className="flex items-center justify-between px-10 py-10 bg-white/5 hover:bg-white/10 rounded-[2.5rem] transition-all group border border-white/10 backdrop-blur-xl"
                    >
                      <div className="flex flex-col items-start gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-40">Подключиться к комнате</span>
                        <span className="text-3xl font-black uppercase italic tracking-tighter">Войти в игру</span>
                      </div>
                      <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 group-hover:-rotate-12 transition-all duration-500">
                        <LogIn className="w-8 h-8" />
                      </div>
                    </motion.button>
                  </div>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, ease: "circOut" }}
                  className="space-y-12 relative z-10"
                >
                  <div className="space-y-6">
                    <div className="flex justify-between items-center px-2">
                      <label className="text-[10px] uppercase tracking-[0.5em] font-black text-zinc-500">Код сессии</label>
                      <button 
                        onClick={() => setIsJoining(false)} 
                        className="text-[10px] uppercase font-black text-zinc-600 hover:text-white transition-colors flex items-center gap-2 group"
                      >
                        <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
                        В меню
                      </button>
                    </div>
                    <div className="relative group">
                      <div className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center group-focus-within:bg-orange-500/20 transition-all duration-500">
                        <Search className="w-5 h-5 text-zinc-500 group-focus-within:text-orange-500 transition-colors" />
                      </div>
                      <input
                        type="text"
                        placeholder="6-ЗНАЧНЫЙ КОД"
                        className="w-full bg-black/60 border border-white/10 rounded-[2rem] py-8 pl-20 pr-8 focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all text-2xl font-black tracking-[0.4em] uppercase placeholder:text-zinc-800 text-center font-mono text-white"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <label className="text-[10px] uppercase tracking-[0.5em] font-black text-zinc-500 ml-2">Ваше имя</label>
                    <div className="relative group">
                      <div className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center group-focus-within:bg-orange-500/20 transition-all duration-500">
                        <User className="w-5 h-5 text-zinc-500 group-focus-within:text-orange-500 transition-colors" />
                      </div>
                      <input
                        type="text"
                        placeholder="ВВЕДИТЕ ВАШЕ ИМЯ"
                        className="w-full bg-black/60 border border-white/10 rounded-[2rem] py-8 pl-20 pr-8 focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all text-base font-black tracking-[0.2em] uppercase placeholder:text-zinc-800 text-white"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02, y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={joinRoom}
                    disabled={isConnecting || !roomId.trim() || !playerName.trim()}
                    className="w-full flex items-center justify-center gap-6 py-10 bg-orange-600 hover:bg-orange-500 rounded-[2.5rem] transition-all font-black uppercase italic tracking-tighter text-3xl shadow-[0_20px_50px_rgba(234,88,12,0.4)] disabled:opacity-50 relative overflow-hidden group"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    {isConnecting ? (
                      <RefreshCw className="w-10 h-10 animate-spin" />
                    ) : (
                      <>
                        Войти в лобби
                        <Play className="w-8 h-8 group-hover:translate-x-2 transition-transform" />
                      </>
                    )}
                  </motion.button>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>

        {/* How to Play Modal */}
        <AnimatePresence>
          {showHowToPlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-orange-600/10 blur-[100px] rounded-full -mr-32 -mt-32" />
                
                <div className="relative z-10 space-y-10">
                  <div className="flex items-center justify-between">
                    <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white">Как <span className="text-orange-600">Играть</span></h2>
                    <button 
                      onClick={() => setShowHowToPlay(false)}
                      className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5"
                    >
                      <Plus className="w-6 h-6 rotate-45" />
                    </button>
                  </div>

                  <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                    <section className="space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-[0.4em] text-orange-500">Цель</h3>
                      <p className="text-zinc-400 leading-relaxed font-medium">
                        Игра делится на две команды: <span className="text-red-400 font-bold">Мафия</span> и <span className="text-green-400 font-bold">Мирные жители</span>. 
                        Мафия побеждает, если устранит достаточно жителей. 
                        Жители побеждают, если вычислят и выгонят всю Мафию.
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-[0.4em] text-orange-500">Фазы</h3>
                      <div className="grid gap-4">
                        <div className="p-6 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                          <div className="flex items-center gap-3">
                            <Moon className="w-4 h-4 text-indigo-400" />
                            <p className="text-sm font-black uppercase tracking-widest text-white">Ночная фаза</p>
                          </div>
                          <p className="text-xs text-zinc-500 leading-relaxed">Все закрывают глаза. Мафия выбирает цель для устранения. Доктор выбирает, кого защитить. Детектив проверяет личность одного игрока.</p>
                        </div>
                        <div className="p-6 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                          <div className="flex items-center gap-3">
                            <Sun className="w-4 h-4 text-orange-400" />
                            <p className="text-sm font-black uppercase tracking-widest text-white">Дневная фаза</p>
                          </div>
                          <p className="text-xs text-zinc-500 leading-relaxed">Город просыпается и узнает, кто был устранен. Игроки обсуждают подозрения и пытаются найти Мафию. В конце все голосуют, чтобы выгнать одного игрока.</p>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-[0.4em] text-orange-500">Советы</h3>
                      <ul className="space-y-3">
                        <li className="flex gap-3 text-xs text-zinc-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-orange-600 mt-1.5 shrink-0" />
                          Следите за подозрительным поведением во время обсуждения.
                        </li>
                        <li className="flex gap-3 text-xs text-zinc-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-orange-600 mt-1.5 shrink-0" />
                          Если вы Доктор, старайтесь предугадать цель Мафии.
                        </li>
                        <li className="flex gap-3 text-xs text-zinc-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-orange-600 mt-1.5 shrink-0" />
                          Детективу стоит быть осторожным с раскрытием себя слишком рано.
                        </li>
                      </ul>
                    </section>
                  </div>

                  <button 
                    onClick={() => setShowHowToPlay(false)}
                    className="w-full py-6 bg-orange-600 hover:bg-orange-500 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-orange-900/40"
                  >
                    Понятно, погнали
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const me = room.players.find(p => p.id === peerRef.current?.id);

  return (
    <div className={cn(
      "min-h-screen text-zinc-100 flex flex-col font-sans overflow-hidden selection:bg-orange-500/30 transition-colors duration-1000",
      room.phase === 'night' ? "bg-[#020205]" : "bg-[#050505]"
    )}>
      <Toaster position="top-center" theme="dark" richColors />
      
      {/* Dynamic Background Atmosphere - Recipe 7 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div 
          animate={{ 
            scale: room.phase === 'night' ? 1.2 : 1,
            opacity: room.phase === 'night' ? 0.15 : 0.05
          }}
          className="absolute top-[-10%] left-[-10%] w-[80%] h-[80%] bg-orange-600 blur-[180px] rounded-full" 
        />
        <motion.div 
          animate={{ 
            scale: room.phase === 'night' ? 1.5 : 1,
            opacity: room.phase === 'night' ? 0.2 : 0.05
          }}
          className="absolute bottom-[-10%] right-[-10%] w-[80%] h-[80%] bg-indigo-600 blur-[180px] rounded-full" 
        />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] mix-blend-overlay" />
        
        {/* Phase-specific particles */}
        <AnimatePresence>
          {room.phase === 'night' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              {[...Array(30)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: Math.random() * 1000 }}
                  animate={{ 
                    opacity: [0, 0.3, 0], 
                    y: [Math.random() * 1000, Math.random() * 1000 - 200],
                  }}
                  transition={{ duration: 5 + Math.random() * 10, repeat: Infinity, ease: "linear" }}
                  className="absolute w-0.5 h-0.5 bg-indigo-400 rounded-full"
                  style={{ left: `${Math.random() * 100}%` }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {(room.phase === 'night' || room.phase === 'day_results' || room.phase === 'voting' || room.phase === 'game_over') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0, rotateX: 90 }}
              animate={{ scale: 1, opacity: 1, rotateX: 0 }}
              exit={{ scale: 1.5, opacity: 0 }}
              transition={{ type: "spring", damping: 12, stiffness: 100 }}
              className="bg-black/80 backdrop-blur-3xl border border-white/10 px-20 py-10 rounded-[4rem] shadow-[0_0_100px_rgba(249,115,22,0.2)]"
            >
              <h1 className="text-9xl font-black italic uppercase tracking-tighter text-white leading-none text-center">
                {room.phase === 'night' && <span className="text-indigo-500">Ночь <br/><span className="text-4xl tracking-[0.5em] not-italic font-medium opacity-50">Наступила</span></span>}
                {room.phase === 'day_results' && <span className="text-orange-500">День <br/><span className="text-4xl tracking-[0.5em] not-italic font-medium opacity-50">Настал</span></span>}
                {room.phase === 'voting' && <span className="text-red-500">Время <br/><span className="text-4xl tracking-[0.5em] not-italic font-medium opacity-50">Голосовать</span></span>}
                {room.phase === 'game_over' && <span className="text-yellow-500">Игра <br/><span className="text-4xl tracking-[0.5em] not-italic font-medium opacity-50">Окончена</span></span>}
              </h1>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
      <header className="h-24 border-b border-white/5 flex items-center justify-between px-10 bg-black/40 backdrop-blur-3xl sticky top-0 z-50 ring-1 ring-white/5">
        <div className="flex items-center gap-8">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="flex flex-col cursor-default"
          >
            <h2 className="text-4xl font-black italic tracking-tighter text-white uppercase leading-none">
              Фруктовая <span className="text-orange-600">Мафия</span>
            </h2>
            <span className="text-[8px] font-black tracking-[0.5em] uppercase text-zinc-500 mt-1">Социальная дедукция в AR</span>
          </motion.div>
          <div className="h-10 w-px bg-white/10" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 px-5 py-2.5 bg-white/5 rounded-2xl border border-white/5 shadow-inner group hover:bg-white/10 transition-colors">
              <Users className="w-4 h-4 text-orange-500 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black tracking-widest uppercase text-white">{room.players.length} <span className="text-zinc-500">/ {room.maxPlayers}</span></span>
            </div>
            <div className="flex items-center gap-3 px-5 py-2.5 bg-white/5 rounded-2xl border border-white/5 shadow-inner group hover:bg-white/10 transition-colors">
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                room.status === 'playing' ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]"
              )} />
              <span className="text-xs font-black tracking-widest uppercase text-white">{STATUS_NAMES[room.status]}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 px-6 py-3 bg-orange-600/10 rounded-2xl border border-orange-600/20">
            <span className="text-[10px] font-black tracking-[0.2em] uppercase text-orange-500/60">Текущая фаза</span>
            <span className="text-sm font-black tracking-widest uppercase text-orange-500 italic">{PHASE_NAMES[room.phase]}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={copyCode}
              className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 transition-all rounded-2xl border border-white/5 flex items-center gap-4 group active:scale-95"
            >
              <div className="flex flex-col items-start">
                <span className="text-[8px] font-black tracking-widest uppercase text-zinc-500">Код комнаты</span>
                <span className="text-sm font-mono font-black text-white">{room.id}</span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-zinc-500 group-hover:text-white" />}
              </div>
            </button>
            
            <button 
              onClick={() => window.location.reload()}
              className="w-12 h-12 flex items-center justify-center bg-zinc-900 hover:bg-red-900/40 transition-all rounded-2xl border border-white/5 text-zinc-600 hover:text-red-500 active:scale-95"
              title="Покинуть комнату"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-10 flex gap-10 overflow-hidden relative z-10">
        {/* Game Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 overflow-y-auto pr-4 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {room.players.map(player => (
              <motion.div 
                layout
                key={player.id} 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                transition={{ type: "spring", damping: 20, stiffness: 100 }}
                className={cn(
                  "relative group rounded-[3rem] overflow-hidden border-4 transition-all duration-700",
                  player.isAlive 
                    ? "border-white/5 shadow-2xl hover:border-orange-500/30 hover:shadow-orange-500/20" 
                    : "border-red-900/30 grayscale opacity-40",
                  room.phase === 'night' && me?.role === 'mafia' && player.role === 'mafia' && "border-red-600/50 shadow-[0_0_30px_rgba(220,38,38,0.2)]"
                )}
              >
                <div className="aspect-[4/5] relative">
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
                  <div className="absolute top-8 left-8 right-8 flex justify-between items-start pointer-events-none z-20">
                    <div className="px-5 py-2.5 bg-black/60 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl ring-1 ring-white/5">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white">{player.name}</p>
                    </div>
                    
                    {room.status === 'playing' && player.id === peerRef.current?.id && (
                      <motion.div 
                        initial={{ scale: 0.8, opacity: 0, x: 20 }}
                        animate={{ scale: 1, opacity: 1, x: 0 }}
                        className="px-5 py-2.5 bg-orange-600 rounded-2xl shadow-[0_15px_30px_rgba(234,88,12,0.5)] border border-orange-400/30"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white italic">{ROLE_NAMES[player.role!]}</p>
                      </motion.div>
                    )}
                  </div>

                  {/* Dead Overlay */}
                  {!player.isAlive && (
                    <div className="absolute inset-0 bg-red-950/60 flex flex-col items-center justify-center backdrop-blur-sm z-30">
                      <motion.div
                        initial={{ scale: 0.5, rotate: -20 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className="p-6 rounded-full bg-red-600 shadow-[0_0_50px_rgba(220,38,38,0.5)]"
                      >
                        <Skull className="w-12 h-12 text-white" />
                      </motion.div>
                      <p className="text-xs font-black uppercase tracking-[0.5em] text-white mt-6 drop-shadow-lg">Исключен</p>
                    </div>
                  )}

                  {/* Voting Results Overlay */}
                  {room.phase === 'elimination' && (
                    <div className="absolute bottom-20 left-6 right-6 flex flex-wrap gap-2 z-20">
                      {Object.entries(room.lastVotes)
                        .filter(([_, targetId]) => targetId === player.id)
                        .map(([voterId]) => {
                          const voter = room.players.find(p => p.id === voterId);
                          return (
                            <motion.div 
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              key={voterId} 
                              className="px-3 py-1.5 bg-black/80 backdrop-blur-xl rounded-xl border border-white/10 text-[9px] font-black uppercase text-zinc-300 shadow-xl"
                            >
                              {voter?.name}
                            </motion.div>
                          );
                        })}
                    </div>
                  )}

                  {/* Action Button Overlay */}
                  {room.status === 'playing' && me?.isAlive && player.isAlive && player.id !== me.id && (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center p-10 z-40 backdrop-blur-sm">
                      <div className="w-full space-y-4">
                        {room.phase === 'night' && (
                          <>
                            {me.role === 'mafia' && (
                              <motion.button 
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleNightAction(player.id)}
                                className="w-full py-5 bg-red-600 hover:bg-red-500 rounded-[1.5rem] font-black uppercase text-xs tracking-[0.2em] shadow-[0_20px_40px_rgba(220,38,38,0.4)] text-white border border-red-400/30"
                              >
                                Устранить
                              </motion.button>
                            )}
                            {me.role === 'doctor' && (
                              <motion.button 
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleNightAction(player.id)}
                                className="w-full py-5 bg-green-600 hover:bg-green-500 rounded-[1.5rem] font-black uppercase text-xs tracking-[0.2em] shadow-[0_20px_40px_rgba(34,197,94,0.4)] text-white border border-green-400/30"
                              >
                                Защитить
                              </motion.button>
                            )}
                            {me.role === 'detective' && (
                              <motion.button 
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleNightAction(player.id)}
                                className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-[1.5rem] font-black uppercase text-xs tracking-[0.2em] shadow-[0_20px_40px_rgba(37,99,235,0.4)] text-white border border-blue-400/30"
                              >
                                Проверить
                              </motion.button>
                            )}
                          </>
                        )}
                        {room.phase === 'voting' && (
                          <motion.button 
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => castVote(player.id)}
                            className={cn(
                              "w-full py-5 rounded-[1.5rem] font-black uppercase text-xs tracking-[0.2em] shadow-2xl transition-all border",
                              room.votes[me.id] === player.id 
                                ? "bg-orange-600 text-white border-orange-400/30 shadow-[0_20px_40px_rgba(234,88,12,0.4)]" 
                                : "bg-white text-black border-white/20 hover:bg-zinc-200"
                            )}
                          >
                            {room.votes[me.id] === player.id ? 'Проголосовано' : 'Голосовать'}
                          </motion.button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Sidebar */}
        <aside className="w-[28rem] flex flex-col gap-8">
          {/* Game Control Card */}
          <div className="bg-zinc-900/40 border border-white/5 backdrop-blur-3xl rounded-[3rem] p-10 space-y-10 shadow-2xl relative overflow-hidden flex flex-col">
            <div className="absolute top-0 right-0 w-40 h-40 bg-orange-600/5 blur-3xl rounded-full -mr-20 -mt-20" />
            
            <div className="space-y-6 relative z-10">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Статус игры</h3>
                <div className="px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
                  {room.players.filter(p => p.isAlive).length} Живы
                </div>
              </div>

              {room.status === 'lobby' && room.host === peerRef.current?.id && (
                <div className="space-y-6">
                  <div className="p-8 bg-black/40 rounded-[2rem] border border-white/5 text-center space-y-4">
                    <Users className="w-12 h-12 text-zinc-700 mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-zinc-300">Ожидание игроков...</p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Нужно еще {Math.max(0, 5 - room.players.length)} для начала</p>
                    </div>
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(room.players.length / 5) * 100}%` }}
                        className="h-full bg-orange-600"
                      />
                    </div>
                  </div>
                  
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={startGame}
                    disabled={room.players.length < 5}
                    className="w-full py-8 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:grayscale transition-all rounded-[2rem] font-black uppercase italic tracking-tighter text-2xl shadow-[0_20px_40px_rgba(234,88,12,0.3)]"
                  >
                    Начать игру
                  </motion.button>
                </div>
              )}

              {room.status === 'playing' && (
                <div className="space-y-6">
                  <div className="p-8 bg-black/40 rounded-[2rem] border border-white/5 space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-orange-600/20 flex items-center justify-center border border-orange-600/20">
                        {room.phase === 'night' ? <Moon className="w-6 h-6 text-orange-500" /> : <Sun className="w-6 h-6 text-orange-500" />}
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Текущая фаза</p>
                        <p className="text-xl font-black uppercase italic tracking-tighter text-white">{PHASE_NAMES[room.phase]}</p>
                      </div>
                    </div>
                    
                    <p className="text-xs text-zinc-400 leading-relaxed font-medium">
                      {room.phase === 'night' && "Мафия выбирает цель. Доктор и Детектив выполняют свои обязанности."}
                      {room.phase === 'day_results' && "Солнце встает. Город узнает, что произошло ночью."}
                      {room.phase === 'voting' && "Время обсуждения. Проголосуйте за того, кого подозреваете в причастности к Мафии."}
                      {room.phase === 'elimination' && "Голоса подсчитаны. Кто-то покидает игру."}
                    </p>
                  </div>

                  {room.host === peerRef.current?.id && (room.phase === 'day_results' || room.phase === 'day_discussion') && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={nextPhase}
                      className="w-full py-6 bg-white text-black hover:bg-zinc-200 transition-all rounded-2xl font-black uppercase tracking-widest text-xs"
                    >
                      {room.phase === 'day_results' ? 'Начать обсуждение' : 'Открыть голосование'}
                    </motion.button>
                  )}
                </div>
              )}

              {room.status === 'ended' && (
                <div className="space-y-6">
                  <div className={cn(
                    "p-10 rounded-[2.5rem] text-center space-y-4 border-4",
                    room.winner === 'mafia' ? "bg-red-600/10 border-red-600/30" : "bg-green-600/10 border-green-600/30"
                  )}>
                    <Trophy className={cn("w-20 h-20 mx-auto", room.winner === 'mafia' ? "text-red-500" : "text-green-500")} />
                    <div className="space-y-1">
                      <h4 className="text-4xl font-black uppercase italic tracking-tighter text-white">
                        {room.winner === 'mafia' ? 'Мафия победила' : 'Жители победили'}
                      </h4>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Игра окончена</p>
                    </div>
                  </div>
                  
                  {room.host === peerRef.current?.id && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => window.location.reload()}
                      className="w-full py-6 bg-zinc-800 hover:bg-zinc-700 transition-all rounded-2xl font-black uppercase tracking-widest text-xs border border-white/5"
                    >
                      Вернуться в меню
                    </motion.button>
                  )}
                </div>
              )}
            </div>

            {/* Game Logs */}
            <div className="flex-1 min-h-0 flex flex-col mt-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-4 bg-orange-600 rounded-full" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-500">Журнал событий</h3>
                </div>
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => <div key={i} className="w-1 h-1 rounded-full bg-zinc-800" />)}
                </div>
              </div>
              <div className="flex-1 bg-black/40 rounded-[2.5rem] border border-white/5 p-8 overflow-y-auto custom-scrollbar space-y-4 shadow-inner ring-1 ring-white/5">
                {room.logs.slice().reverse().map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={i} 
                    className="flex gap-4 text-[11px] leading-relaxed group"
                  >
                    <span className="text-zinc-600 font-mono shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">[{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</span>
                    <span className={cn(
                      "font-medium transition-colors",
                      log.type === 'danger' ? "text-red-400" : 
                      log.type === 'success' ? "text-green-400" : 
                      log.type === 'system' ? "text-orange-400" : "text-zinc-400"
                    )}>
                      {log.message}
                    </span>
                  </motion.div>
                ))}
                {room.logs.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-4">
                    <div className="w-12 h-12 rounded-full border-2 border-dashed border-zinc-800 animate-[spin_10s_linear_infinite]" />
                    <p className="text-[10px] font-black uppercase tracking-[0.4em]">Событий пока нет</p>
                  </div>
                )}
              </div>
            </div>
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
