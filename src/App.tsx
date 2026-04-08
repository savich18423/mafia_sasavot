import React, { useEffect, useState, useRef, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { FruitFace } from './components/FruitFace';
import { cn } from './lib/utils';
import { 
  User, Users, Play, LogIn, Plus, Shield, Heart, 
  Search, MessageSquare, Send, Copy, Check, Info, 
  Moon, Sun, Vote, AlertCircle, Trophy, RefreshCw, LogOut,
  Music, Volume2, VolumeX, SkipForward, SkipBack, Repeat, Trash2, PlusCircle, X, Settings,
  Pause, Play as PlayIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';

// --- Types ---

type Role = 'mafia' | 'doctor' | 'detective' | 'citizen';
type Phase = 'waiting' | 'night' | 'day_results' | 'day_discussion' | 'voting' | 'elimination' | 'game_over';
type GameMode = 'classic' | 'blind' | 'chaos' | 'speedrun' | 'hardcore';

interface Player {
  id: string;
  name: string;
  role: Role | null;
  isAlive: boolean;
  fruit: string;
  isDisconnected?: boolean;
  disconnectTime?: number;
  sessionToken?: string;
  isBot?: boolean;
}

interface Reaction {
  playerId: string;
  emoji: string;
  timestamp: number;
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

interface MusicTrack {
  id: string;
  name: string;
  data: string; // base64
  suggestedBy?: string;
  suggestedByName?: string;
}

interface MusicSettings {
  volume: number;
  loop: boolean;
  isPlaying: boolean;
  currentTrackId: string | null;
  playlist: MusicTrack[];
  suggestions: MusicTrack[];
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
  isPaused?: boolean;
  pausedBy?: string;
  pauseTimer?: number;
  musicSettings: MusicSettings;
  gameMode: GameMode;
  characterSet: 'fruits' | 'vegetables';
  reactions: Reaction[];
}

const FRUITS = [
  'watermelon', 'apple', 'orange', 'grapefruit', 'pomelo', 
  'lemon', 'lime', 'guava', 'apricot', 'tangerine',
  'strawberry', 'blueberry', 'cherry', 'banana', 'pineapple', 'mango'
];

const VEGETABLES = [
  'tomato', 'pumpkin', 'cucumber', 'pattypan', 'turnip',
  'pepper', 'zucchini', 'eggplant', 'cabbage', 'potato', 'onion'
];

const BOT_NAMES = [
  'Алексей', 'Мария', 'Иван', 'Елена', 'Дмитрий', 'Ольга', 'Сергей', 'Анна', 
  'Николай', 'Татьяна', 'Андрей', 'Наталья', 'Виктор', 'Светлана', 'Михаил', 'Юлия',
  'Артем', 'Ксения', 'Павел', 'Ирина', 'Денис', 'Алина', 'Роман', 'Дарья'
];

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

const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  waiting: 'Ожидаем игроков для начала...',
  night: 'Город засыпает, просыпается мафия.',
  day_results: 'Город проснулся. Узнаем, что произошло.',
  day_discussion: 'Обсудите события и найдите мафию.',
  voting: 'Пришло время выбрать, кто покинет город.',
  elimination: 'Голоса подсчитаны. Кто-то покидает игру.',
  game_over: 'Игра окончена. Подводим итоги.'
};

const STATUS_NAMES: Record<string, string> = {
  lobby: 'В лобби',
  playing: 'В игре',
  ended: 'Завершена'
};

// --- Main Component ---

// --- Sub-components ---

const MusicPlayer = ({ room, peerId, updateMusicSettings, theme }: { 
  room: Room | null, 
  peerId: string | undefined, 
  updateMusicSettings: (settings: Partial<MusicSettings>) => void,
  theme: any 
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isAudioBlocked, setIsAudioBlocked] = useState(false);
  
  if (!room?.musicSettings) return null;
  const { musicSettings } = room;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = musicSettings.volume;
    audio.loop = musicSettings.loop;
    
    if (musicSettings.isPlaying) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          // AbortError is expected when track changes or pause is called quickly
          if (e.name === 'NotAllowedError') {
            setIsAudioBlocked(true);
          } else if (e.name !== 'AbortError') {
            console.error("Audio play error:", e);
          }
        });
      }
    } else {
      audio.pause();
    }
  }, [musicSettings.isPlaying, musicSettings.volume, musicSettings.loop, musicSettings.currentTrackId]);

  const currentTrack = musicSettings.playlist.find(t => t.id === musicSettings.currentTrackId);

  return (
    <>
      <audio 
        ref={audioRef} 
        src={currentTrack?.data} 
        onEnded={() => {
          if (!musicSettings.loop && room!.host === peerId) {
            const currentIndex = musicSettings.playlist?.findIndex(t => t.id === musicSettings.currentTrackId) ?? -1;
            const nextIndex = (currentIndex + 1) % (musicSettings.playlist?.length || 1);
            const nextTrack = musicSettings.playlist?.[nextIndex];
            if (nextTrack) {
              updateMusicSettings({ currentTrackId: nextTrack.id, isPlaying: true });
            } else {
              updateMusicSettings({ isPlaying: false });
            }
          }
        }}
      />
      {isAudioBlocked && musicSettings.isPlaying && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100]"
        >
          <button
            onClick={() => {
              setIsAudioBlocked(false);
              audioRef.current?.play().catch(console.error);
            }}
            className={cn(
              "flex items-center gap-3 px-6 py-3 rounded-full font-bold uppercase tracking-wider text-sm shadow-2xl border animate-bounce",
              theme.accentBg,
              theme.border
            )}
          >
            <Volume2 className="w-5 h-5" />
            Включить звук музыки
          </button>
        </motion.div>
      )}
      {currentTrack && !currentTrack.data && musicSettings.isPlaying && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100]"
        >
          <div className={cn(
            "flex items-center gap-3 px-6 py-4 rounded-3xl font-bold uppercase tracking-wider text-[10px] shadow-2xl border bg-red-600 text-white border-red-400 max-w-xs text-center",
          )}>
            <AlertCircle className="w-5 h-5 shrink-0" />
            Файл музыки не найден. После обновления страницы музыку нужно загрузить заново.
          </div>
        </motion.div>
      )}
    </>
  );
};

const ReactionMenu = ({ onSelect }: { onSelect: (emoji: string) => void }) => {
  return null;
};

const THEMES_DATA: Record<string, any> = {
  default: {
    bg: 'bg-zinc-950',
    header: 'bg-black/40',
    card: 'bg-black/40',
    accent: 'text-orange-500',
    accentBg: 'bg-orange-600',
    border: 'border-white/5',
    text: 'text-white',
    muted: 'text-zinc-500',
    overlay: 'bg-indigo-950/20'
  },
  sasavot: {
    bg: 'bg-red-950',
    bgImage: 'https://media1.tenor.com/m/TO4KD8Pf5kYAAAAd/sasavot-eb2chugun.gif',
    header: 'bg-red-900/40',
    card: 'bg-red-900/40',
    accent: 'text-red-500',
    accentBg: 'bg-red-700',
    border: 'border-red-500/20',
    text: 'text-red-50',
    muted: 'text-red-400/60',
    overlay: 'bg-red-950/40',
    style: { fontFamily: 'serif' }
  },
  helin139: {
    bg: 'bg-yellow-400',
    bgImage: 'https://media1.tenor.com/m/2xaL-1aQvPgAAAAd/uglyfacekid-helin139.gif',
    header: 'bg-yellow-500/40',
    card: 'bg-yellow-500/40',
    accent: 'text-blue-600',
    accentBg: 'bg-blue-600',
    border: 'border-blue-500/20',
    text: 'text-blue-900',
    muted: 'text-blue-800/60',
    overlay: 'bg-yellow-600/20'
  },
  rostikfacekid: {
    bg: 'bg-[#0a0a0a]',
    bgImage: 'https://media1.tenor.com/m/JTTB2p8k7IsAAAAd/uglyfacekid.gif',
    header: 'bg-[#1a1a1a]/40',
    card: 'bg-[#1a1a1a]/40',
    accent: 'text-[#00ffcc]',
    accentBg: 'bg-[#00ffcc]',
    border: 'border-[#00ffcc]/20',
    text: 'text-[#eaeaea]',
    muted: 'text-zinc-500',
    overlay: 'bg-black/60',
    glitch: true
  },
  iceicell: {
    bg: 'bg-[#f2e6d8]',
    isLight: true,
    bgImage: 'https://photobooth.cdn.sports.ru/preset/wysiwyg/8/e1/05bc339944cccb2addc1a3d0137f7.jpeg?f=webp&q=90&s=2x&w=730',
    header: 'bg-[#d89aa6]/20',
    card: 'bg-white/40',
    accent: 'text-[#7a3b4a]',
    accentBg: 'bg-[#d89aa6]',
    border: 'border-[#d89aa6]/40',
    text: 'text-[#555]',
    muted: 'text-[#7a3b4a]/60',
    overlay: 'bg-[#d89aa6]/10',
    glow: 'rgba(216, 154, 166, 0.2)'
  },
  formixyouknow: {
    bg: 'bg-[#111]',
    bgVideo: 'https://vk.com/doc188558635_166709657?hash=ZMDdJhGmltRiL1M02gnlAsuKntz2K88xZD0wCY1w3r8&dl=vwBHe0QgUeeJOfpvjluZB7xWEBVfPhyvXLN8cwDeMtT&wnd=1&module=board&mp4=1',
    header: 'bg-black/40',
    card: 'bg-zinc-900/40',
    accent: 'text-[#ff7a00]',
    accentBg: 'bg-[#ff7a00]',
    border: 'border-[#ffd000]/20',
    text: 'text-white',
    muted: 'text-[#ffd000]/60',
    overlay: 'bg-orange-950/20',
    glow: 'rgba(255, 122, 0, 0.2)'
  },
  yurapivo: {
    bg: 'bg-black',
    bgImage: 'https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/CleverSilkyDonkeyFeelsBadMan-QxnqXdfX0Um907d_/9625e32b-a857-412d-aea4-c9fa0c07052c/preview.jpg',
    header: 'bg-purple-900/20',
    card: 'bg-purple-900/20',
    accent: 'text-pink-500',
    accentBg: 'bg-purple-600',
    border: 'border-pink-500/20',
    text: 'text-pink-50',
    muted: 'text-purple-400',
    overlay: 'bg-pink-950/20',
    glow: 'rgba(236, 72, 153, 0.2)'
  },
  r4dom1r: {
    bg: 'bg-zinc-900',
    bgImage: 'https://i.ibb.co/fVxBc87T/2026-04-08-212052.png',
    header: 'bg-black/60',
    card: 'bg-black/40',
    accent: 'text-zinc-400',
    accentBg: 'bg-zinc-700',
    border: 'border-white/10',
    text: 'text-zinc-100',
    muted: 'text-zinc-500',
    overlay: 'bg-black/40',
    glow: 'rgba(255, 255, 255, 0.1)'
  },
  tankzor: {
    bg: 'bg-black',
    bgImage: 'https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/VastHilariousPieWoofer-SXASnOGvNwMTjVIZ/241daec9-f568-4d56-895c-26dc456dd0fb/preview.jpg',
    header: 'bg-red-900/20',
    card: 'bg-zinc-900/60',
    accent: 'text-red-600',
    accentBg: 'bg-red-700',
    border: 'border-purple-500/20',
    text: 'text-white',
    muted: 'text-purple-400',
    overlay: 'bg-red-950/40',
    glow: 'rgba(220, 38, 38, 0.2)'
  },
  poisonika: {
    bg: 'bg-white',
    isLight: true,
    bgImage: 'https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/HandsomePiliableBarracudaPartyTime-e375qxvX8rlfAhu0/99935b1e-51b0-48b9-a2d1-c157bde3071a/preview.jpg',
    header: 'bg-zinc-100',
    card: 'bg-zinc-50',
    accent: 'text-[#7a3b4a]',
    accentBg: 'bg-[#7a3b4a]',
    border: 'border-[#7a3b4a]/20',
    text: 'text-zinc-900',
    muted: 'text-zinc-500',
    overlay: 'bg-zinc-200/40',
    handDrawn: true,
    glow: 'rgba(122, 59, 74, 0.1)'
  }
};

const BackgroundAtmosphere = React.memo(({ theme, phase, disabled }: { theme: any, phase?: Phase, disabled?: boolean }) => {
  if (disabled) return null;
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {theme.bgVideo ? (
        <video
          key={theme.bgVideo}
          autoPlay
          muted
          loop
          playsInline
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            theme.isLight ? "opacity-20" : "opacity-40 mix-blend-overlay"
          )}
        >
          <source src={theme.bgVideo} type="video/mp4" />
        </video>
      ) : theme.bgImage ? (
        <div 
          className={cn(
            "absolute inset-0 bg-cover bg-center bg-no-repeat",
            theme.isLight ? "opacity-20" : "opacity-40 mix-blend-overlay"
          )}
          style={{ backgroundImage: `url(${theme.bgImage})` }}
        />
      ) : (
        <>
          <motion.div 
            animate={{ 
              scale: phase === 'night' ? 1.2 : 1,
              opacity: phase === 'night' ? 0.15 : 0.05
            }}
            className={cn("absolute top-[-10%] left-[-10%] w-[80%] h-[80%] blur-[180px] rounded-full", theme.accentBg)} 
          />
          <motion.div 
            animate={{ 
              scale: phase === 'night' ? 1.5 : 1,
              opacity: phase === 'night' ? 0.2 : 0.05
            }}
            className="absolute bottom-[-10%] right-[-10%] w-[80%] h-[80%] bg-indigo-600 blur-[180px] rounded-full" 
          />
        </>
      )}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] mix-blend-overlay" />
    </div>
  );
});

export default function App() {
  const [userType, setUserType] = useState<'none' | 'regular' | 'streamer'>(() => 
    (localStorage.getItem('mafia_user_type') as any) || 'none'
  );
  const [selectedTheme, setSelectedTheme] = useState<string>(() => 
    localStorage.getItem('mafia_theme') || 'default'
  );
  const [disableCustomBackground, setDisableCustomBackground] = useState<boolean>(() => 
    localStorage.getItem('mafia_disable_bg') === 'true'
  );
  const [customBgUrl, setCustomBgUrl] = useState<string>(() => 
    localStorage.getItem('mafia_custom_bg') || ''
  );
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [lastActionTime, setLastActionTime] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [botCount, setBotCount] = useState(4);
  const [room, setRoom] = useState<Room | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [showPhaseOverlay, setShowPhaseOverlay] = useState(false);

  useEffect(() => {
    if (room?.phase && room.phase !== 'waiting' && room.phase !== 'game_over') {
      setShowPhaseOverlay(true);
      const timer = setTimeout(() => setShowPhaseOverlay(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [room?.phase]);

  useEffect(() => {
    if (userType !== 'none') localStorage.setItem('mafia_user_type', userType);
  }, [userType]);

  useEffect(() => {
    localStorage.setItem('mafia_theme', selectedTheme);
  }, [selectedTheme]);

  useEffect(() => {
    localStorage.setItem('mafia_custom_bg', customBgUrl);
  }, [customBgUrl]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup old reactions
  useEffect(() => {
    if (!room || room.host !== peerRef.current?.id) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const hasOldReactions = room.reactions.some(r => now - r.timestamp > 5000);
      if (hasOldReactions) {
        const updatedRoom = {
          ...room,
          reactions: room.reactions.filter(r => now - r.timestamp <= 5000)
        };
        broadcast(updatedRoom);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [room?.reactions.length]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !room) return;
    const file = e.target.files[0];
    // Increase limit to 10MB as requested
    if (file.size > 10 * 1024 * 1024) return toast.error('Файл слишком большой (макс. 10МБ)');
    
    try {
      const base64 = await fileToBase64(file);
      const isHost = room.host === peerRef.current?.id;
      
      if (isHost) {
        const newTrack: MusicTrack = {
          id: Math.random().toString(36).substring(2, 15),
          name: file.name,
          data: base64
        };
        const updatedRoom = {
          ...room,
          musicSettings: {
            ...(room.musicSettings || {
              playlist: [],
              suggestions: [],
              currentTrackId: null,
              isPlaying: false,
              volume: 0.5,
              loop: false
            }),
            playlist: [...(room.musicSettings?.playlist || []), newTrack]
          }
        };
        broadcast(updatedRoom);
        toast.success('Музыка добавлена в плейлист');
      } else {
        // Send suggestion to host
        Object.values(connectionsRef.current).forEach((conn) => {
          const c = conn as DataConnection;
          if (c.peer === room.host && c.open) {
            c.send({ 
              type: 'SUGGEST_MUSIC', 
              name: file.name, 
              data: base64,
              playerName: playerName
            });
          }
        });
        toast.success('Предложение отправлено хосту');
      }
    } catch (err) {
      console.error("Music upload error:", err);
      toast.error('Ошибка при загрузке файла. Возможно, файл слишком велик.');
    }
  };

  const updateMusicSettings = (settings: Partial<MusicSettings>) => {
    if (!room || room.host !== peerRef.current?.id || !room.musicSettings) return;
    const updatedRoom = {
      ...room,
      musicSettings: {
        ...room.musicSettings,
        ...settings
      }
    };
    broadcast(updatedRoom);
  };

  const acceptMusic = (trackId: string) => {
    if (!room || room.host !== peerRef.current?.id || !room.musicSettings) return;
    const track = room.musicSettings.suggestions.find(t => t.id === trackId);
    if (!track) return;

    const updatedRoom = {
      ...room,
      musicSettings: {
        ...room.musicSettings,
        suggestions: room.musicSettings.suggestions.filter(t => t.id !== trackId),
        playlist: [...room.musicSettings.playlist, track]
      },
      logs: [{ message: `Принята музыка: ${track.name}`, type: 'success', timestamp: Date.now() }, ...room.logs]
    };
    broadcast(updatedRoom);
  };

  const declineMusic = (trackId: string) => {
    if (!room || room.host !== peerRef.current?.id || !room.musicSettings) return;
    const updatedRoom = {
      ...room,
      musicSettings: {
        ...room.musicSettings,
        suggestions: room.musicSettings.suggestions.filter(t => t.id !== trackId)
      }
    };
    broadcast(updatedRoom);
  };

  const removeMusic = (trackId: string) => {
    if (!room || room.host !== peerRef.current?.id || !room.musicSettings) return;
    const updatedRoom = {
      ...room,
      musicSettings: {
        ...room.musicSettings,
        playlist: room.musicSettings.playlist.filter(t => t.id !== trackId),
        currentTrackId: room.musicSettings.currentTrackId === trackId ? null : room.musicSettings.currentTrackId,
        isPlaying: room.musicSettings.currentTrackId === trackId ? false : room.musicSettings.isPlaying
      }
    };
    broadcast(updatedRoom);
  };

  // Migration: Ensure musicSettings exists when room is updated
  useEffect(() => {
    if (room && (!room.musicSettings || !room.musicSettings.playlist || !room.musicSettings.suggestions)) {
      const updatedRoom = {
        ...room,
        musicSettings: {
          playlist: room.musicSettings?.playlist || [],
          suggestions: room.musicSettings?.suggestions || [],
          currentTrackId: room.musicSettings?.currentTrackId || null,
          isPlaying: room.musicSettings?.isPlaying || false,
          volume: room.musicSettings?.volume ?? 0.5,
          loop: room.musicSettings?.loop || false
        }
      };
      setRoom(updatedRoom);
    }
  }, [room]);

  const [activeTab, setActiveTab] = useState<'chat' | 'logs'>('chat');
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showMusicSettings, setShowMusicSettings] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
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

  useEffect(() => {
    const getCameras = async () => {
      try {
        // Request permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ video: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameras(videoDevices);
        
        if (videoDevices.length > 0) {
          // Prioritize Snap Camera if available
          const snapCam = videoDevices.find(d => d.label.toLowerCase().includes('snap camera'));
          if (snapCam) {
            setSelectedCameraId(snapCam.deviceId);
          } else if (!selectedCameraId) {
            setSelectedCameraId(videoDevices[0].deviceId);
          }
        }
      } catch (err) {
        console.error('Error getting cameras:', err);
      }
    };
    getCameras();
  }, []); // Run once on mount

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
    // If we already have a stream, stop it first to switch cameras
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    try {
      const constraints: MediaStreamConstraints = { 
        video: selectedCameraId 
          ? { deviceId: { exact: selectedCameraId }, width: { ideal: 640 }, height: { ideal: 480 } } 
          : { width: { ideal: 640 }, height: { ideal: 480 } }, 
        audio: true 
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.warn('Camera/Mic access denied, creating empty stream:', err);
      
      // Create a silent audio track and a black video track if possible, 
      // or just return a dummy stream so the game can continue.
      try {
        // Create a dummy canvas for a black video stream
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        const videoStream = canvas.captureStream(1);
        const videoTrack = videoStream.getVideoTracks()[0];
        
        // Create a silent audio track
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const dst = audioCtx.createMediaStreamDestination();
        oscillator.connect(dst);
        const audioTrack = dst.stream.getAudioTracks()[0];
        audioTrack.enabled = false; // Keep it silent
        
        const dummyStream = new MediaStream([videoTrack, audioTrack]);
        setLocalStream(dummyStream);
        
        toast.info('Вход без камеры и микрофона');
        return dummyStream;
      } catch (dummyErr) {
        console.error('Failed to create dummy stream:', dummyErr);
        toast.error('Не удалось инициализировать медиа-поток');
        return null;
      }
    }
  };

  const [sessionToken] = useState(() => {
    const saved = localStorage.getItem('mafia_session_token');
    if (saved) return saved;
    const newToken = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('mafia_session_token', newToken);
    return newToken;
  });

  useEffect(() => {
    const savedRoomId = localStorage.getItem('mafia_room_id');
    const savedName = localStorage.getItem('mafia_player_name');
    const savedIsHost = localStorage.getItem('mafia_is_host') === 'true';
    const savedRoom = localStorage.getItem('mafia_room_state');

    if (savedRoomId && savedName && !room) {
      setRoomId(savedRoomId);
      setPlayerName(savedName);
      
      // If was host, try to recover room
      if (savedIsHost && savedRoom) {
        try {
          const recoveredRoom = JSON.parse(savedRoom) as Room;
          
          // Migration: Ensure musicSettings exists
          if (!recoveredRoom.musicSettings) {
            recoveredRoom.musicSettings = {
              volume: 0.5,
              loop: true,
              isPlaying: false,
              currentTrackId: null,
              playlist: [],
              suggestions: []
            };
          }
          
          // We need to re-initialize as host
          recoverRoomAsHost(recoveredRoom, savedName);
        } catch (e) {
          console.error("Failed to recover room state", e);
        }
      } else {
        // If was player, try to auto-rejoin
        autoRejoin(savedRoomId, savedName);
      }
    }
  }, []);

  const recoverRoomAsHost = async (recoveredRoom: Room, name: string) => {
    setIsConnecting(true);
    const stream = await startMedia();
    if (!stream) return setIsConnecting(false);

    const peer = new Peer(recoveredRoom.id, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      // Mark host as connected
      const updatedPlayers = recoveredRoom.players.map(p => 
        p.id === recoveredRoom.host ? { ...p, isDisconnected: false, disconnectTime: undefined } : p
      );
      const updatedRoom = { ...recoveredRoom, players: updatedPlayers };
      setRoom(updatedRoom);
      setIsConnecting(false);
      toast.success('Комната восстановлена!');
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

  const autoRejoin = async (rId: string, name: string) => {
    setRoomId(rId);
    setPlayerName(name);
    setIsJoining(true);
    toast.info('Переподключение к комнате...');
    joinRoom(rId, name);
  };

  useEffect(() => {
    if (room) {
      try {
        localStorage.setItem('mafia_room_id', room.id);
        localStorage.setItem('mafia_player_name', playerName);
        localStorage.setItem('mafia_is_host', (room.host === peerRef.current?.id).toString());
        
        if (room.host === peerRef.current?.id) {
          // Create a "lite" version of the room state for localStorage to avoid QuotaExceededError
          // We strip the heavy base64 audio data, but keep the track metadata
          const persistentRoom = {
            ...room,
            musicSettings: room.musicSettings ? {
              ...room.musicSettings,
              playlist: room.musicSettings.playlist.map(t => ({ ...t, data: '' })),
              suggestions: room.musicSettings.suggestions.map(t => ({ ...t, data: '' }))
            } : undefined
          };
          localStorage.setItem('mafia_room_state', JSON.stringify(persistentRoom));
        }
      } catch (e) {
        console.warn("Failed to save state to localStorage (likely quota exceeded):", e);
        // If it fails, we still want to save the basic info if possible
        try {
          localStorage.setItem('mafia_room_id', room.id);
          localStorage.setItem('mafia_player_name', playerName);
        } catch (innerE) {
          console.error("Critical localStorage failure:", innerE);
        }
      }
    }
  }, [room, playerName]);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentRoom = roomRef.current;
      if (!currentRoom || currentRoom.host !== peerRef.current?.id || !currentRoom.isPaused || !currentRoom.pauseTimer) return;

      const elapsed = (Date.now() - currentRoom.pauseTimer) / 1000;
      if (elapsed >= 20) {
        // Time is up, but we keep the room paused until the host decides
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handlePeerConnection = (conn: DataConnection, stream: MediaStream) => {
    conn.on('data', (data: any) => {
      if (data.type === 'JOIN_REQUEST') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        // Check for reconnection
        const existingPlayerIndex = currentRoom.players.findIndex(p => p.sessionToken === data.sessionToken);
        
        if (existingPlayerIndex !== -1) {
          const existingPlayer = currentRoom.players[existingPlayerIndex];
          const updatedPlayers = [...currentRoom.players];
          updatedPlayers[existingPlayerIndex] = { 
            ...existingPlayer, 
            id: conn.peer, 
            isDisconnected: false,
            disconnectTime: undefined 
          };
          
          let updatedRoom = { 
            ...currentRoom, 
            players: updatedPlayers,
            logs: [{ message: `${data.playerName} вернулся в игру`, type: 'success', timestamp: Date.now() }, ...currentRoom.logs]
          };

          // Resume if this was the player who caused the pause
          if (currentRoom.isPaused && currentRoom.pausedBy === existingPlayer.id) {
            updatedRoom.isPaused = false;
            updatedRoom.pausedBy = undefined;
            updatedRoom.pauseTimer = undefined;
          }

          broadcast(updatedRoom);
          return;
        }

        if (currentRoom.players.length >= currentRoom.maxPlayers) {
          conn.send({ type: 'ERROR', message: 'Комната заполнена' });
          return;
        }

        const pool = currentRoom.characterSet === 'vegetables' ? VEGETABLES : FRUITS;
        const fruit = pool.find(f => !currentRoom.players.map(p => p.fruit).includes(f)) || (currentRoom.characterSet === 'vegetables' ? 'tomato' : 'orange');
        const newPlayer: Player = { 
          id: conn.peer, 
          name: data.playerName, 
          role: null, 
          isAlive: true, 
          fruit,
          sessionToken: data.sessionToken
        };
        const updatedRoom = { 
          ...currentRoom, 
          players: [...currentRoom.players, newPlayer],
          logs: [{ message: `${data.playerName} зашел в лобби`, type: 'system', timestamp: Date.now() }, ...currentRoom.logs]
        };
        broadcast(updatedRoom);
      }
      
      if (data.type === 'ROOM_UPDATE') {
        setRoom(data.room);
        setIsConnecting(false);
        // Connect to any new players for media
        data.room.players.forEach((p: Player) => {
          if (p.id !== peerRef.current?.id && !peerStreamsRef.current[p.id] && !connectionsRef.current[p.id]) {
            console.log('Connecting to new player:', p.name);
            const newConn = peerRef.current!.connect(p.id);
            connectionsRef.current[p.id] = newConn;
            handlePeerConnection(newConn, stream);
            
            // Only the person with the "smaller" ID initiates the call to avoid double calls
            if (peerRef.current!.id < p.id) {
              const call = peerRef.current!.call(p.id, stream);
              call.on('stream', (remoteStream) => {
                setPeerStreams(prev => ({ ...prev, [p.id]: remoteStream }));
              });
            }
          }
        });
      }

      if (data.type === 'ERROR') {
        toast.error(data.message);
        setError(data.message);
        setIsConnecting(false);
      }

      if (data.type === 'PLAYER_LEFT_INTENTIONALLY') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        const player = currentRoom.players.find(p => p.id === data.playerId);
        if (!player) return;

        const updatedPlayers = currentRoom.players.filter(p => p.id !== data.playerId);
        const updatedRoom = {
          ...currentRoom,
          players: updatedPlayers,
          logs: [{ message: `${player.name} покинул игру`, type: 'info', timestamp: Date.now() }, ...currentRoom.logs]
        };
        
        if (updatedRoom.isPaused && updatedRoom.pausedBy === data.playerId) {
          updatedRoom.isPaused = false;
          updatedRoom.pausedBy = undefined;
          updatedRoom.pauseTimer = undefined;
        }

        broadcast(updatedRoom);
      }

      if (data.type === 'GAME_RESTART') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        restartGame();
      }

      // --- Music Messages ---
      if (data.type === 'SUGGEST_MUSIC') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        const newTrack: MusicTrack = {
          id: Math.random().toString(36).substring(2, 15),
          name: data.name,
          data: data.data,
          suggestedBy: conn.peer,
          suggestedByName: data.playerName
        };

        const updatedRoom = {
          ...currentRoom,
          musicSettings: {
            ...currentRoom.musicSettings,
            suggestions: [...currentRoom.musicSettings.suggestions, newTrack]
          },
          logs: [{ message: `${data.playerName} предложил музыку: ${data.name}`, type: 'info', timestamp: Date.now() }, ...currentRoom.logs]
        };
        broadcast(updatedRoom);
        toast.info(`Новое предложение музыки от ${data.playerName}`);
      }

      if (data.type === 'ACCEPT_MUSIC') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        const track = currentRoom.musicSettings.suggestions.find(t => t.id === data.trackId);
        if (!track) return;

        const updatedRoom = {
          ...currentRoom,
          musicSettings: {
            ...currentRoom.musicSettings,
            suggestions: currentRoom.musicSettings.suggestions.filter(t => t.id !== data.trackId),
            playlist: [...currentRoom.musicSettings.playlist, track]
          },
          logs: [{ message: `Принята музыка: ${track.name}`, type: 'success', timestamp: Date.now() }, ...currentRoom.logs]
        };
        broadcast(updatedRoom);
      }

      if (data.type === 'DECLINE_MUSIC') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        const track = currentRoom.musicSettings.suggestions.find(t => t.id === data.trackId);
        if (!track) return;

        const updatedRoom = {
          ...currentRoom,
          musicSettings: {
            ...currentRoom.musicSettings,
            suggestions: currentRoom.musicSettings.suggestions.filter(t => t.id !== data.trackId)
          }
        };
        broadcast(updatedRoom);
      }

      if (data.type === 'UPDATE_MUSIC_SETTINGS') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        const updatedRoom = {
          ...currentRoom,
          musicSettings: {
            ...currentRoom.musicSettings,
            ...data.settings
          }
        };
        broadcast(updatedRoom);
      }

      if (data.type === 'GAME_CONTINUE') {
        const currentRoom = roomRef.current;
        if (!currentRoom || currentRoom.host !== peerRef.current?.id) return;
        
        // Remove the disconnected player who caused the pause
        const updatedPlayers = currentRoom.players.filter(p => p.id !== currentRoom.pausedBy);
        const updatedRoom = {
          ...currentRoom,
          players: updatedPlayers,
          isPaused: false,
          pausedBy: undefined,
          pauseTimer: undefined,
          logs: [{ message: 'Игра продолжена без одного игрока', type: 'info', timestamp: Date.now() }, ...currentRoom.logs]
        };
        broadcast(updatedRoom);
      }
    });

    conn.on('close', () => {
      const currentRoom = roomRef.current;
      if (!currentRoom) return;
      
      const player = currentRoom.players.find(p => p.id === conn.peer);
      if (!player) {
        // Player might have already been removed intentionally
        return;
      }

      // If I'm the host, handle the disconnection
      if (currentRoom.host === peerRef.current?.id) {
        // Mark as disconnected
        const updatedPlayers = currentRoom.players.map(p => 
          p.id === conn.peer ? { ...p, isDisconnected: true, disconnectTime: Date.now() } : p
        );

        let updatedRoom = { ...currentRoom, players: updatedPlayers };

        if (currentRoom.status === 'playing' && !currentRoom.isPaused) {
          updatedRoom.isPaused = true;
          updatedRoom.pausedBy = player.id;
          updatedRoom.pauseTimer = Date.now();
          updatedRoom.logs = [{ message: `${player.name} отключился. Ожидание 20 секунд...`, type: 'danger', timestamp: Date.now() }, ...updatedRoom.logs];
        }

        broadcast(updatedRoom);
      } else if (conn.peer === currentRoom.host) {
        // If host disconnected, try to reconnect after a delay
        toast.error('Хост отключился. Пытаемся переподключиться...');
        setTimeout(() => {
          if (roomRef.current && !roomRef.current.isDisconnected) {
            joinRoom();
          }
        }, 3000);
      }
    });
  };

  const checkRateLimit = () => {
    const now = Date.now();
    const timeWindow = 10000; // 10 seconds
    const maxActions = 5;

    if (now - lastActionTime > timeWindow) {
      setLastActionTime(now);
      setActionCount(1);
      setIsRateLimited(false);
      return true;
    }

    if (actionCount >= maxActions) {
      setIsRateLimited(true);
      toast.error('Слишком много запросов. Пожалуйста, подождите.');
      return false;
    }

    setActionCount(prev => prev + 1);
    return true;
  };

  const createRoom = async () => {
    if (!checkRateLimit()) return;
    const trimmedName = playerName.trim();
    if (!trimmedName) return toast.error('Введите ваше имя');
    setIsConnecting(true);
    const stream = await startMedia();
    if (!stream) return setIsConnecting(false);

    const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const peer = new Peer(shortId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    });
    peerRef.current = peer;

    const randomFruit = FRUITS[Math.floor(Math.random() * FRUITS.length)];

    peer.on('open', (id) => {
      const initialRoom: Room = {
        id: id,
        host: id,
        players: [{ id, name: trimmedName, role: null, isAlive: true, fruit: randomFruit }],
        maxPlayers: 12,
        status: 'lobby',
        phase: 'waiting',
        nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
        votes: {},
        chat: [],
        detectiveResults: {},
        lastVotes: {},
        logs: [{ message: 'Комната создана. Ожидание игроков...', type: 'system', timestamp: Date.now() }],
        winner: null,
        gameMode: 'classic',
        characterSet: 'fruits',
        reactions: [],
        musicSettings: {
          volume: 0.5,
          loop: true,
          isPlaying: false,
          currentTrackId: null,
          playlist: [],
          suggestions: []
        }
      };
      initialRoom.players[0].sessionToken = sessionToken;
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

  const joinRoom = async (overrideId?: string | React.MouseEvent, overrideName?: string) => {
    if (!checkRateLimit()) return;
    const id = typeof overrideId === 'string' ? overrideId : roomId;
    const name = typeof overrideName === 'string' ? overrideName : playerName;
    
    const trimmedName = name.trim();
    const trimmedRoomId = id.trim().toUpperCase();
    if (!trimmedName || !trimmedRoomId) return toast.error('Введите имя и ID комнаты');
    setIsConnecting(true);
    const stream = await startMedia();
    if (!stream) return setIsConnecting(false);

    const peer = new Peer(undefined, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      const conn = peer.connect(trimmedRoomId);
      connectionsRef.current[trimmedRoomId] = conn;
      
      conn.on('open', () => {
        conn.send({ type: 'JOIN_REQUEST', playerName: trimmedName, sessionToken: sessionToken });
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

  const updateGameMode = (mode: GameMode) => {
    if (!room || room.host !== peerRef.current?.id) return;
    const updatedRoom = { ...room, gameMode: mode };
    broadcast(updatedRoom);
  };

  const updateCharacterSet = (set: 'fruits' | 'vegetables') => {
    if (!room || room.host !== peerRef.current?.id) return;
    
    // Update existing players to the new set
    const pool = set === 'vegetables' ? VEGETABLES : FRUITS;
    const updatedPlayers = room.players.map((p, i) => ({
      ...p,
      fruit: pool[i % pool.length]
    }));

    const updatedRoom = { ...room, characterSet: set, players: updatedPlayers };
    broadcast(updatedRoom);
  };

  const addBots = (count: number) => {
    if (!room || room.host !== peerRef.current?.id) return;
    
    const currentPlayers = room.players;
    const characterPool = room.characterSet === 'vegetables' ? VEGETABLES : FRUITS;
    const availableCharacters = characterPool.filter(f => !currentPlayers.map(p => p.fruit).includes(f));
    const availableNames = BOT_NAMES.filter(n => !currentPlayers.map(p => p.name).includes(n));
    
    const newBots: Player[] = [];
    for (let i = 0; i < count; i++) {
      if (currentPlayers.length + newBots.length >= room.maxPlayers) break;
      
      const fruit = availableCharacters[i % availableCharacters.length] || (room.characterSet === 'vegetables' ? 'tomato' : 'orange');
      const name = availableNames[i % availableNames.length] || `Бот ${i + 1}`;
      
      newBots.push({
        id: `bot-${Math.random().toString(36).substring(2, 9)}`,
        name: name,
        role: null,
        isAlive: true,
        fruit,
        isBot: true,
        sessionToken: `bot-token-${Math.random().toString(36).substring(2, 9)}`
      });
    }
    
    const updatedRoom = {
      ...room,
      players: [...currentPlayers, ...newBots],
      logs: [{ message: `Добавлено ${newBots.length} ботов`, type: 'system', timestamp: Date.now() }, ...room.logs]
    };
    broadcast(updatedRoom);
  };

  const removeBots = () => {
    if (!room || room.host !== peerRef.current?.id) return;
    const updatedRoom = {
      ...room,
      players: room.players.filter(p => !p.isBot),
      logs: [{ message: 'Все боты удалены', type: 'system', timestamp: Date.now() }, ...room.logs]
    };
    broadcast(updatedRoom);
  };

  // Speedrun Mode Logic
  useEffect(() => {
    if (!room || room.host !== peerRef.current?.id || room.status !== 'playing' || room.gameMode !== 'speedrun' || room.isPaused) return;

    const phaseTimers: Record<Phase, number> = {
      waiting: 0,
      night: 15000, // 15s for night
      day_results: 5000, // 5s for results
      day_discussion: 20000, // 20s for discussion
      voting: 15000, // 15s for voting
      elimination: 5000, // 5s for elimination
      game_over: 0
    };

    const duration = phaseTimers[room.phase];
    if (duration === 0) return;

    const timer = setTimeout(() => {
      if (room.phase === 'night') {
        resolveNight(room);
      } else if (room.phase === 'voting') {
        resolveVoting(room);
      } else {
        nextPhase();
      }
    }, duration);

    return () => clearTimeout(timer);
  }, [room?.phase, room?.status, room?.gameMode, room?.isPaused]);

  // Bot Logic
  useEffect(() => {
    if (!room || room.host !== peerRef.current?.id || room.status !== 'playing') return;

    const interval = setInterval(() => {
      const currentRoom = roomRef.current;
      if (!currentRoom || currentRoom.isPaused) return;
      
      const bots = currentRoom.players.filter(p => p.isBot && p.isAlive);
      if (bots.length === 0) return;

      const updatedRoom = { ...currentRoom };
      let changed = false;

      // Night actions
      if (updatedRoom.phase === 'night') {
        bots.forEach(bot => {
          if (bot.role === 'mafia' && !updatedRoom.nightActions.mafiaTarget) {
            const targets = updatedRoom.players.filter(p => p.isAlive && p.role !== 'mafia');
            if (targets.length > 0) {
              const target = targets[Math.floor(Math.random() * targets.length)];
              updatedRoom.nightActions.mafiaTarget = target.id;
              updatedRoom.logs = [{ message: `Мафия выбрала цель: ${target.name}.`, type: 'system', timestamp: Date.now() }, ...updatedRoom.logs];
              changed = true;
            }
          }
          if (bot.role === 'doctor' && !updatedRoom.nightActions.doctorTarget) {
            const targets = updatedRoom.players.filter(p => p.isAlive);
            if (targets.length > 0) {
              const target = targets[Math.floor(Math.random() * targets.length)];
              updatedRoom.nightActions.doctorTarget = target.id;
              updatedRoom.logs = [{ message: `Доктор решил защитить: ${target.name}.`, type: 'system', timestamp: Date.now() }, ...updatedRoom.logs];
              changed = true;
            }
          }
          if (bot.role === 'detective' && !updatedRoom.nightActions.detectiveTarget) {
            const targets = updatedRoom.players.filter(p => p.isAlive && p.id !== bot.id && !updatedRoom.detectiveResults[p.id]);
            if (targets.length > 0) {
              const target = targets[Math.floor(Math.random() * targets.length)];
              updatedRoom.nightActions.detectiveTarget = target.id;
              updatedRoom.logs = [{ message: `Детектив проверил: ${target.name}.`, type: 'system', timestamp: Date.now() }, ...updatedRoom.logs];
              changed = true;
            }
          }
        });

        if (changed) {
          const aliveMafia = updatedRoom.players.some(p => p.role === 'mafia' && p.isAlive);
          const aliveDoctor = updatedRoom.players.some(p => p.role === 'doctor' && p.isAlive);
          const aliveDetective = updatedRoom.players.some(p => p.role === 'detective' && p.isAlive);

          const mafiaActed = !aliveMafia || updatedRoom.nightActions.mafiaTarget;
          const doctorActed = !aliveDoctor || updatedRoom.nightActions.doctorTarget;
          const detectiveActed = !aliveDetective || updatedRoom.nightActions.detectiveTarget;

          if (mafiaActed && doctorActed && detectiveActed) {
            resolveNight(updatedRoom);
            return;
          }
        }
      }

      // Voting
      if (updatedRoom.phase === 'voting') {
        bots.forEach(bot => {
          if (!updatedRoom.votes[bot.id]) {
            const targets = updatedRoom.players.filter(p => p.isAlive && p.id !== bot.id);
            if (targets.length > 0) {
              const target = targets[Math.floor(Math.random() * targets.length)];
              updatedRoom.votes[bot.id] = target.id;
              updatedRoom.logs = [{ message: `${bot.name} проголосовал.`, type: 'info', timestamp: Date.now() }, ...updatedRoom.logs];
              changed = true;
            }
          }
        });

        if (changed) {
          const aliveCount = updatedRoom.players.filter(p => p.isAlive).length;
          if (Object.keys(updatedRoom.votes).length === aliveCount) {
            resolveVoting(updatedRoom);
            return;
          }
        }
      }

      // Bot Chat Messages
      if (updatedRoom.phase === 'day_discussion' && Math.random() < 0.05) {
        const randomBot = bots[Math.floor(Math.random() * bots.length)];
        const messages = [
          'Я думаю, это кто-то из новеньких...',
          'Подозрительно как-то всё это.',
          'Кто мафия? Признавайтесь!',
          'Я точно мирный житель.',
          'Давайте голосовать аккуратно.',
          'Мне кажется, я видел что-то странное ночью.',
          'Кто-нибудь еще заметил подозрительное поведение?',
          'Я верю Детективу, если он есть.'
        ];
        const newMessage: ChatMessage = {
          senderId: randomBot.id,
          senderName: randomBot.name,
          text: messages[Math.floor(Math.random() * messages.length)],
          timestamp: Date.now()
        };
        updatedRoom.chat = [...updatedRoom.chat, newMessage];
        changed = true;
      }

      if (changed) {
        broadcast(updatedRoom);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [room?.status, room?.host]);

  const sendReaction = (emoji: string) => {
    if (!roomRef.current) return;
    const me = roomRef.current.players.find(p => p.id === peerRef.current?.id);
    if (!me) return;

    const newReaction: Reaction = {
      playerId: me.id,
      emoji,
      timestamp: Date.now()
    };
    
    const updatedRoom = {
      ...roomRef.current,
      reactions: [...roomRef.current.reactions, newReaction].slice(-20)
    };
    broadcast(updatedRoom);
  };

  const startGame = () => {
    if (!room) return;
    
    const minPlayers = room.gameMode === 'chaos' ? 12 : 5;
    if (room.players.length < minPlayers) {
      return toast.error(`Для этого режима нужно минимум ${minPlayers} игроков`);
    }

    const shuffled = [...room.players].sort(() => 0.5 - Math.random());
    
    let mafiaCount = Math.max(1, Math.floor(room.players.length / 4));
    if (room.gameMode === 'chaos') {
      mafiaCount = 3;
    }
    
    const updatedPlayers = room.players.map(p => {
      const index = shuffled.findIndex(s => s.id === p.id);
      let role: Role = 'citizen';
      if (index < mafiaCount) role = 'mafia';
      else if (room.gameMode !== 'hardcore') {
        if (index === mafiaCount) role = 'doctor';
        else if (index === mafiaCount + 1) role = 'detective';
      }
      return { ...p, role };
    });

    const modeName = {
      classic: 'Классический',
      blind: 'Вслепую',
      chaos: 'Рубилово (3 Мафии)',
      speedrun: 'Спидран (Авто-фазы)',
      hardcore: 'Хардкор (Без Доктора/Детектива)'
    }[room.gameMode];

    const updatedRoom: Room = {
      ...room,
      status: 'playing',
      phase: 'night',
      players: updatedPlayers,
      nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
      logs: [
        { message: `Игра началась! Режим: ${modeName}`, type: 'system', timestamp: Date.now() },
        { message: 'Наступила ночь. Город засыпает...', type: 'info', timestamp: Date.now() },
        ...room.logs
      ]
    };
    broadcast(updatedRoom);
  };

  const continueGame = () => {
    if (!room || room.host !== peerRef.current?.id || !room.isPaused) return;
    
    const updatedPlayers = room.players.filter(p => p.id !== room.pausedBy);
    const updatedRoom: Room = {
      ...room,
      players: updatedPlayers,
      isPaused: false,
      pausedBy: undefined,
      pauseTimer: undefined,
      logs: [{ message: 'Игра продолжена без одного игрока', type: 'info', timestamp: Date.now() }, ...room.logs]
    };
    broadcast(updatedRoom);
  };

  const leaveRoom = () => {
    if (!room || !peerRef.current) return;
    
    if (room.host !== peerRef.current.id) {
      const hostConn = connectionsRef.current[room.host];
      if (hostConn && hostConn.open) {
        hostConn.send({ type: 'PLAYER_LEFT_INTENTIONALLY', playerId: peerRef.current.id });
      }
    }

    localStorage.removeItem('mafia_room_id');
    localStorage.removeItem('mafia_player_name');
    localStorage.removeItem('mafia_is_host');
    localStorage.removeItem('mafia_room_state');
    
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }
    
    setRoom(null);
    setPeerStreams({});
    connectionsRef.current = {};
    peerStreamsRef.current = {};
    setIsJoining(false);
    setIsConnecting(false);
  };

  const restartGame = () => {
    if (!room || room.host !== peerRef.current?.id) return;
    const updatedRoom: Room = {
      ...room,
      status: 'lobby',
      phase: 'waiting',
      nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
      votes: {},
      detectiveResults: {},
      lastVotes: {},
      isPaused: false,
      pausedBy: undefined,
      pauseTimer: undefined,
      logs: [{ message: 'Игра перезапущена хостом', type: 'system', timestamp: Date.now() }, ...room.logs]
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

  const skipNight = () => {
    if (!room || room.host !== peerRef.current?.id) return;
    resolveNight(room);
  };

  const resolveNight = (currentRoom: Room) => {
    const { mafiaTarget, doctorTarget, detectiveTarget } = currentRoom.nightActions;
    let killedId: string | null = null;
    let logMessage = 'Ночь прошла спокойно. Никто не погиб.';

    if (mafiaTarget && mafiaTarget !== doctorTarget) {
      killedId = mafiaTarget;
      const victim = currentRoom.players.find(p => p.id === killedId);
      const roleReveal = currentRoom.gameMode === 'blind' ? '???' : ROLE_NAMES[victim?.role || 'citizen'];
      logMessage = `${victim?.name} был убит этой ночью. Роль: ${roleReveal}`;
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
      const roleReveal = currentRoom.gameMode === 'blind' ? '???' : roleMap[victim?.role || 'citizen'];
      logMessage = `${victim?.name} был исключен голосованием. Роль: ${roleReveal}`;
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

  const togglePreview = async () => {
    if (isPreviewing) {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
      }
      setIsPreviewing(false);
    } else {
      const stream = await startMedia();
      if (stream) setIsPreviewing(true);
    }
  };

  // Stop preview when switching to room
  useEffect(() => {
    if (room && isPreviewing) {
      setIsPreviewing(false);
    }
  }, [room, isPreviewing]);

  const theme = useMemo(() => {
    if (selectedTheme === 'custom') {
      return { ...THEMES_DATA.default, bgImage: customBgUrl };
    }
    return THEMES_DATA[selectedTheme] || THEMES_DATA.default;
  }, [selectedTheme, customBgUrl]);

  if (userType === 'none') {
    return (
      <div className={cn("min-h-screen flex items-center justify-center p-6 relative overflow-hidden transition-colors duration-1000", theme.bg, theme.text)}>
        <BackgroundAtmosphere theme={theme} disabled={disableCustomBackground} />
        <div className="max-w-md w-full space-y-8 text-center relative z-10">
          <div className="space-y-2">
            <h1 className={cn("text-4xl font-black italic uppercase tracking-tighter", theme.text === 'text-white' ? 'text-white' : theme.text)}>Кто ты?</h1>
            <p className={cn("font-medium opacity-50", theme.muted)}>Выберите ваш тип пользователя</p>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setUserType('regular')}
              className={cn("p-8 border rounded-[2rem] transition-all group", theme.card, theme.border, "hover:border-orange-500/50")}
            >
              <User className="w-12 h-12 text-orange-500 mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className={cn("text-xl font-bold", theme.text)}>Обычный человек</h3>
              <p className={cn("text-sm mt-2 opacity-50", theme.muted)}>Стандартный визуальный стиль</p>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setUserType('streamer')}
              className={cn("p-8 border rounded-[2rem] transition-all group", theme.card, theme.border, "hover:border-purple-500/50")}
            >
              <Users className="w-12 h-12 text-purple-500 mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className={cn("text-xl font-bold", theme.text)}>Стример</h3>
              <p className={cn("text-sm mt-2 opacity-50", theme.muted)}>Персонализированные темы</p>
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  if (userType === 'streamer' && selectedTheme === 'default') {
    const streamers = [
      { id: 'sasavot', name: 'Sasavot', desc: 'Bloodseeker Style' },
      { id: 'helin139', name: 'Helin139', desc: 'Minions Style' },
      { id: 'rostikfacekid', name: 'rostikfacekid', desc: 'Dark Anime Glitch' },
      { id: 'iceicell', name: 'iceicell', desc: 'Soft Anime Sadcore' },
      { id: 'formixyouknow', name: 'formixyouknow', desc: 'Savage Meme Burn' },
      { id: 'yurapivo', name: 'yurapivo', desc: 'Pink & Purple Night' },
      { id: 'r4dom1r', name: 'r4dom1r', desc: 'Mafia Sopranos' },
      { id: 'tankzor', name: 'tankzor', desc: 'Red & Black Fury' },
      { id: 'poisonika', name: 'poisonika', desc: 'Hand-drawn Aesthetic' },
    ];

    return (
      <div className={cn("min-h-screen flex items-center justify-center p-6 relative overflow-hidden transition-colors duration-1000", theme.bg, theme.text)}>
        <BackgroundAtmosphere theme={theme} disabled={disableCustomBackground} />
        <div className="max-w-4xl w-full space-y-8 text-center relative z-10">
          <div className="space-y-2">
            <h1 className={cn("text-4xl font-black italic uppercase tracking-tighter", theme.text === 'text-white' ? 'text-white' : theme.text)}>Выбери свой стиль</h1>
            <p className={cn("font-medium opacity-50", theme.muted)}>Выберите стримера или создайте свой стиль</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {streamers.map((s) => (
              <motion.button
                key={s.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedTheme(s.id)}
                className={cn("p-6 border rounded-3xl transition-all text-left group", theme.card, theme.border, "hover:border-white/20")}
              >
                <h3 className={cn("text-lg font-bold", theme.text)}>{s.name}</h3>
                <p className={cn("text-xs mt-1 opacity-50", theme.muted)}>{s.desc}</p>
              </motion.button>
            ))}

            {/* Custom Theme Option */}
            <div className={cn("p-6 border rounded-3xl space-y-6 text-left md:col-span-3", theme.card, theme.border)}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={cn("text-lg font-bold", theme.text)}>Свой стиль</h3>
                  <p className={cn("text-xs mt-1 opacity-50", theme.muted)}>Вставьте ссылку на изображение или GIF для фона</p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      const newValue = !disableCustomBackground;
                      setDisableCustomBackground(newValue);
                      localStorage.setItem('mafia_disable_bg', String(newValue));
                    }}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-[10px] font-black uppercase tracking-widest",
                      disableCustomBackground ? "bg-red-600 border-red-500 text-white" : cn(theme.card, theme.border, theme.muted)
                    )}
                  >
                    {disableCustomBackground ? 'Фон выключен' : 'Выключить фон'}
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedTheme('custom')}
                    className={cn("px-6 py-2 text-white rounded-xl font-bold text-sm uppercase tracking-widest", theme.accentBg)}
                  >
                    Применить
                  </motion.button>
                </div>
              </div>
              <input 
                type="text"
                value={customBgUrl}
                onChange={(e) => setCustomBgUrl(e.target.value)}
                placeholder="https://example.com/image.gif"
                className={cn("w-full bg-black/40 border rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors", theme.border, "focus:border-orange-500/50", theme.text)}
              />
            </div>
          </div>
          
          <button 
            onClick={() => setUserType('none')}
            className={cn("transition-colors text-sm font-bold uppercase tracking-widest", theme.muted, "hover:text-white")}
          >
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className={cn("min-h-screen flex items-center justify-center p-4 font-sans overflow-hidden relative selection:bg-orange-500/30 transition-colors duration-1000", theme.bg, theme.text)}>
        <Toaster position="top-center" theme={selectedTheme === 'poisonika' || selectedTheme === 'iceicell' ? 'light' : 'dark'} richColors />
        
        <BackgroundAtmosphere theme={theme} disabled={disableCustomBackground} />
        
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.23, 1, 0.32, 1] }}
          className="w-full max-w-[1400px] grid lg:grid-cols-[1.4fr_1fr] gap-12 xl:gap-24 items-center z-10 px-10"
        >
          {/* Left Side: Editorial Branding - Recipe 2 */}
          <div className="space-y-16 lg:pr-6">
            <div className="space-y-8">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className={cn("inline-flex items-center gap-3 px-4 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-[0.3em]", theme.card, theme.border, theme.accent)}
              >
                <div className={cn("w-2 h-2 rounded-full animate-ping", theme.accentBg)} />
                AR игра на выживание в реальном времени
              </motion.div>
              
              <div className="relative">
                <motion.h1 
                  initial={{ scale: 0.8, opacity: 0, rotateX: 45 }}
                  animate={{ scale: 1, opacity: 1, rotateX: 0 }}
                  transition={{ delay: 0.4, type: "spring", stiffness: 50 }}
                  className={cn("text-[10vw] lg:text-[5.5rem] xl:text-[7rem] font-black tracking-tighter uppercase italic leading-[0.85] text-white")}
                >
                  Фруктовая <br />
                  <span className={theme.accent}>Мафия</span>
                </motion.h1>
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ delay: 1, duration: 1.5, ease: "circOut" }}
                  className={cn("h-1 mt-4 bg-gradient-to-r from-transparent to-transparent", theme.accentBg)}
                  style={{ backgroundImage: `linear-gradient(to right, var(--tw-gradient-from), transparent)` }}
                />
              </div>

              <div className="flex items-center gap-4">
                <p className={cn("text-xl max-w-lg font-medium leading-relaxed", theme.muted)}>
                  Разоблачите предателей, скрывающихся за анимированными говорящими фруктами. Игра на выживание, где на кону доверие и хитрость.
                </p>
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => {
                      setUserType('none');
                      setSelectedTheme('default');
                      localStorage.removeItem('mafia_user_type');
                      localStorage.removeItem('mafia_theme');
                    }}
                    className={cn("px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all", theme.card, theme.border, theme.muted, "hover:text-white")}
                  >
                    Сменить тему
                  </button>
                  <button 
                    onClick={() => {
                      const newValue = !disableCustomBackground;
                      setDisableCustomBackground(newValue);
                      localStorage.setItem('mafia_disable_bg', String(newValue));
                    }}
                    className={cn("px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all", 
                      disableCustomBackground ? "bg-red-600 border-red-500 text-white" : cn(theme.card, theme.border, theme.muted, "hover:text-white")
                    )}
                  >
                    {disableCustomBackground ? 'Включить фон' : 'Выключить фон'}
                  </button>
                </div>
              </div>
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
          <div className="relative max-w-xl mx-auto lg:mx-0 w-full">
            {/* Decorative Glow */}
            <div className="absolute -inset-4 bg-orange-600/20 blur-[100px] rounded-full opacity-50 animate-pulse" />
            
            <div className={cn("border p-12 rounded-[4rem] shadow-[0_40px_100px_rgba(0,0,0,0.5)] relative overflow-hidden ring-1 ring-white/5", theme.card, theme.border)}>
              <div className={cn("absolute top-0 right-0 w-64 h-64 blur-[100px] rounded-full -mr-32 -mt-32 opacity-20", theme.accentBg)} />
              
              {!isJoining ? (
                <div className="space-y-12 relative z-10">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <label className={cn("text-[10px] uppercase tracking-[0.5em] font-black", theme.muted)}>Личность игрока</label>
                      <div className="flex gap-1">
                        {[...Array(3)].map((_, i) => <div key={i} className={cn("w-1 h-1 rounded-full opacity-40", theme.accentBg)} />)}
                      </div>
                    </div>
                    <div className="relative group">
                      <div className={cn("absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center transition-all duration-500", theme.border)}>
                        <User className={cn("w-5 h-5 transition-colors", theme.muted)} />
                      </div>
                      <input
                        type="text"
                        placeholder="ВВЕДИТЕ ВАШЕ ИМЯ"
                        maxLength={20}
                        className={cn("w-full bg-black/60 border rounded-[2rem] py-8 pl-20 pr-8 focus:outline-none focus:ring-4 transition-all text-base font-black tracking-[0.2em] uppercase placeholder:opacity-20", theme.border, theme.text)}
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
                      className={cn(
                        "flex items-center justify-between px-10 py-10 rounded-[2.5rem] transition-all group disabled:opacity-50 relative overflow-hidden",
                        theme.accentBg,
                        "shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
                      )}
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
                      className={cn(
                        "flex items-center justify-between px-10 py-10 bg-white/5 hover:bg-white/10 rounded-[2.5rem] transition-all group border",
                        theme.border
                      )}
                    >
                      <div className="flex flex-col items-start gap-2">
                        <span className={cn("text-[10px] font-black uppercase tracking-[0.4em]", theme.muted)}>Подключиться к комнате</span>
                        <span className="text-3xl font-black uppercase italic tracking-tighter">Войти в игру</span>
                      </div>
                      <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 group-hover:-rotate-12 transition-all duration-500">
                        <LogIn className={cn("w-8 h-8", theme.accent)} />
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
                      <div className={cn("absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center transition-all duration-500", theme.border)}>
                        <Search className={cn("w-5 h-5 transition-colors", theme.muted)} />
                      </div>
                      <input
                        type="text"
                        placeholder="6-ЗНАЧНЫЙ КОД"
                        maxLength={10}
                        className={cn("w-full bg-black/60 border rounded-[2rem] py-8 pl-20 pr-8 focus:outline-none focus:ring-4 transition-all text-2xl font-black tracking-[0.4em] uppercase placeholder:opacity-20 text-center font-mono", theme.border, theme.text)}
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <label className={cn("text-[10px] uppercase tracking-[0.5em] font-black ml-2", theme.muted)}>Ваше имя</label>
                    <div className="relative group">
                      <div className={cn("absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center transition-all duration-500", theme.border)}>
                        <User className={cn("w-5 h-5 transition-colors", theme.muted)} />
                      </div>
                      <input
                        type="text"
                        placeholder="ВВЕДИТЕ ВАШЕ ИМЯ"
                        className={cn("w-full bg-black/60 border rounded-[2rem] py-8 pl-20 pr-8 focus:outline-none focus:ring-4 transition-all text-base font-black tracking-[0.2em] uppercase placeholder:opacity-20", theme.border, theme.text)}
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02, y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => joinRoom()}
                    disabled={isConnecting || !roomId.trim() || !playerName.trim()}
                    className={cn(
                      "w-full flex items-center justify-center gap-6 py-10 rounded-[2.5rem] transition-all font-black uppercase italic tracking-tighter text-3xl disabled:opacity-50 relative overflow-hidden group",
                      theme.accentBg,
                      "shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
                    )}
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
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80"
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
      "min-h-screen flex flex-col font-sans overflow-hidden transition-colors duration-1000",
      theme.bg,
      theme.text,
      theme.glitch && "glitch-container",
      theme.handDrawn && "hand-drawn-container"
    )} style={theme.style}>
      <Toaster position="top-center" theme={selectedTheme === 'poisonika' || selectedTheme === 'iceicell' ? 'light' : 'dark'} richColors />
      
      <BackgroundAtmosphere theme={theme} phase={room.phase} disabled={disableCustomBackground} />

      {/* Large Phase Overlay removed as requested */}

      {/* Night Overlay */}
      <AnimatePresence>
        {room.phase === 'night' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn("fixed inset-0 z-[60] pointer-events-none mix-blend-multiply", theme.overlay)}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <header className={cn(
        "h-24 border-b flex items-center justify-between px-10 sticky top-0 z-50 ring-1 ring-white/5",
        theme.header,
        theme.border
      )}>
        <div className="flex items-center gap-10">
          <div className="flex flex-col">
            <h1 className="text-3xl font-black italic uppercase tracking-tighter leading-none font-display">
              Фруктовая <span className={theme.accent}>Мафия</span>
            </h1>
            <p className={cn("text-[8px] font-black tracking-[0.4em] uppercase opacity-40 mt-1", theme.muted)}>Социальная дедукция в AR</p>
          </div>
          
          <div className="h-10 w-px bg-white/10" />
          
          <div className="flex items-center gap-6">
            <div className={cn("flex items-center gap-3 px-5 py-2 rounded-2xl border bg-white/5", theme.border)}>
              <Users className={cn("w-4 h-4", theme.accent)} />
              <span className="text-sm font-black tabular-nums">{room.players.length} / {room.maxPlayers}</span>
            </div>
            
            <div className={cn("flex items-center gap-3 px-5 py-2 rounded-2xl border bg-white/5", theme.border)}>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
              <span className="text-[10px] font-black uppercase tracking-widest">В игре</span>
            </div>

            <div className={cn("flex items-center gap-4 px-5 py-2 rounded-2xl border bg-white/5 group relative", theme.border)}>
              <Music className={cn("w-4 h-4", theme.accent)} />
              <div className="flex flex-col">
                <span className={cn("text-[8px] font-black uppercase tracking-widest opacity-40", theme.muted)}>Музыка</span>
                <span className="text-[10px] font-bold truncate max-w-[80px]">
                  {room.musicSettings?.playlist.find(t => t.id === room.musicSettings?.currentTrackId)?.name || 'Тишина'}
                </span>
              </div>
              <button 
                onClick={() => setShowMusicSettings(true)}
                className="absolute inset-0 flex items-center justify-center bg-black/80 opacity-0 group-hover:opacity-100 transition-all rounded-2xl"
              >
                <Settings className="w-4 h-4 text-white animate-spin-slow" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className={cn("flex items-center gap-3 px-6 py-3 rounded-2xl border bg-white/5 shadow-xl", theme.border)}>
            <span className={cn("text-[10px] font-black tracking-[0.2em] uppercase opacity-60 font-display", theme.accent)}>Текущая фаза</span>
            <span className={cn("text-sm font-black tracking-widest uppercase italic font-display", theme.accent)}>{PHASE_NAMES[room.phase]}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={copyCode}
              className={cn("px-6 py-3 transition-all rounded-2xl border flex items-center gap-4 group active:scale-95 bg-white/5 hover:bg-white/10", theme.border)}
            >
              <div className="flex flex-col items-start">
                <span className={cn("text-[8px] font-black tracking-widest uppercase", theme.muted)}>Код комнаты</span>
                <span className="text-sm font-mono font-black tracking-tighter">
                  {room.id}
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors border border-white/5">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className={cn("w-4 h-4 group-hover:text-white", theme.muted)} />}
              </div>
            </button>
            
            <button 
              onClick={leaveRoom}
              className={cn("w-12 h-12 flex items-center justify-center transition-all rounded-2xl border active:scale-95 bg-white/5 hover:bg-red-500/20 border-white/5 text-zinc-600 hover:text-red-500")}
              title="Покинуть комнату"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-10 flex gap-10 overflow-hidden relative z-10">
        {/* Game Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-8 overflow-y-auto pr-4 pt-10 pb-32 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {room.players.map(player => (
              <motion.div 
                layout
                key={player.id} 
                initial={{ opacity: 0, scale: 0.8, y: 50, rotateY: 45 }}
                animate={{ 
                  opacity: 1, 
                  scale: 1, 
                  y: 0, 
                  rotateY: 0,
                  transition: { type: "spring", damping: 15, stiffness: 100 }
                }}
                whileHover={{ 
                  scale: 1.03, 
                  y: -15,
                  rotateZ: 0.5,
                  zIndex: 50,
                  transition: { duration: 0.3 }
                }}
                exit={{ opacity: 0, scale: 0.8, y: -50, rotateY: -45 }}
                className={cn(
                  "relative group rounded-[3.5rem] overflow-hidden border-4 transition-all duration-700 shadow-2xl",
                  player.isAlive 
                    ? cn(theme.border, "hover:border-orange-500/50 hover:shadow-orange-500/30") 
                    : "border-red-900/20 opacity-40 grayscale-[0.5]",
                  room.phase === 'night' && me?.role === 'mafia' && player.role === 'mafia' && "border-red-600/60 shadow-[0_0_40px_rgba(220,38,38,0.3)]"
                )}
              >
                {/* Floating effect for alive players */}
                {player.isAlive && (
                  <div className="absolute inset-0 pointer-events-none animate-float opacity-20 bg-gradient-to-b from-white/5 to-transparent" />
                )}
                {/* Reactions Overlay */}
                <div className="absolute top-8 right-8 z-[60] flex flex-col gap-4 pointer-events-none">
                  <AnimatePresence>
                    {room.reactions
                      .filter(r => r.playerId === player.id && Date.now() - r.timestamp < 3000)
                      .map(reaction => (
                        <motion.div
                          key={reaction.timestamp}
                          initial={{ opacity: 0, scale: 0, y: 40, rotate: -45, filter: "blur(10px)" }}
                          animate={{ 
                            opacity: 1, 
                            scale: [0, 2.5, 2], 
                            y: -100, 
                            rotate: [0, 20, -10, 0],
                            filter: "blur(0px)"
                          }}
                          exit={{ opacity: 0, scale: 0, y: -200, filter: "blur(10px)" }}
                          transition={{ 
                            duration: 0.8,
                            ease: "backOut"
                          }}
                          className="text-6xl filter drop-shadow-[0_0_30px_rgba(255,255,255,0.9)] select-none"
                        >
                          {reaction.emoji}
                        </motion.div>
                      ))}
                  </AnimatePresence>
                </div>
                <div className="aspect-[3/4] relative">
                  <FruitFace
                    stream={player.isBot ? null : (player.id === peerRef.current?.id ? localStream : peerStreams[player.id])}
                    fruitType={player.fruit}
                    isLocal={player.id === peerRef.current?.id}
                    playerName={player.name}
                    isAlive={player.isAlive}
                    theme={theme}
                    status={
                      room.phase === 'night' && me?.role === 'mafia' && room.nightActions.mafiaTarget === player.id ? 'targeted' :
                      room.phase === 'night' && me?.role === 'doctor' && room.nightActions.doctorTarget === player.id ? 'protected' :
                      me?.role === 'detective' && room.detectiveResults[player.id] === 'mafia' ? 'investigated_mafia' :
                      me?.role === 'detective' && room.detectiveResults[player.id] === 'citizen' ? 'investigated_citizen' :
                      null
                    }
                    scale={1.5}
                  />
                  
                  {player.isBot && (
                    <div className="absolute top-8 left-8 z-50 px-4 py-1.5 bg-purple-600/20 rounded-xl border border-purple-400/30 shadow-[0_0_20px_rgba(147,51,234,0.3)]">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-200 font-display">BOT</span>
                    </div>
                  )}
                  
                  {/* Action Button Overlay */}
                  {room.status === 'playing' && me?.isAlive && player.isAlive && player.id !== me.id && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-500 flex items-center justify-center p-12 z-40">
                      <div className="w-full space-y-4">
                        {room.phase === 'night' && (
                          <>
                            {me.role === 'mafia' && (
                              <motion.button 
                                whileHover={{ 
                                  scale: 1.05, 
                                  y: -5,
                                  boxShadow: "0 25px 50px rgba(220,38,38,0.5)"
                                }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleNightAction(player.id)}
                                className="w-full py-7 bg-red-600 hover:bg-red-500 rounded-[2.5rem] font-black uppercase text-[11px] tracking-[0.4em] shadow-[0_20px_40px_rgba(220,38,38,0.4)] text-white border border-red-400/30 font-display relative overflow-hidden group/btn"
                              >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-shimmer" />
                                <span className="relative z-10">Устранить</span>
                              </motion.button>
                            )}
                            {me.role === 'doctor' && (
                              <motion.button 
                                whileHover={{ 
                                  scale: 1.05, 
                                  y: -5,
                                  boxShadow: "0 25px 50px rgba(34,197,94,0.5)"
                                }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleNightAction(player.id)}
                                className="w-full py-7 bg-green-600 hover:bg-green-500 rounded-[2.5rem] font-black uppercase text-[11px] tracking-[0.4em] shadow-[0_20px_40px_rgba(34,197,94,0.4)] text-white border border-green-400/30 font-display relative overflow-hidden group/btn"
                              >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-shimmer" />
                                <span className="relative z-10">Защитить</span>
                              </motion.button>
                            )}
                            {me.role === 'detective' && (
                              <motion.button 
                                whileHover={{ 
                                  scale: 1.05, 
                                  y: -5,
                                  boxShadow: "0 25px 50px rgba(37,99,235,0.5)"
                                }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleNightAction(player.id)}
                                className="w-full py-7 bg-blue-600 hover:bg-blue-500 rounded-[2.5rem] font-black uppercase text-[11px] tracking-[0.4em] shadow-[0_20px_40px_rgba(37,99,235,0.4)] text-white border border-blue-400/30 font-display relative overflow-hidden group/btn"
                              >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-shimmer" />
                                <span className="relative z-10">Проверить</span>
                              </motion.button>
                            )}
                          </>
                        )}
                        {room.phase === 'voting' && (
                          <motion.button 
                            whileHover={{ 
                              scale: 1.05, 
                              y: -5,
                              boxShadow: room.votes[me.id] === player.id 
                                ? "0 25px 50px rgba(234,88,12,0.5)" 
                                : "0 25px 50px rgba(0,0,0,0.2)"
                            }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => castVote(player.id)}
                            className={cn(
                              "w-full py-7 rounded-[2.5rem] font-black uppercase text-[11px] tracking-[0.4em] shadow-2xl transition-all border font-display relative overflow-hidden group/btn",
                              room.votes[me.id] === player.id 
                                ? "bg-orange-600 text-white border-orange-400/30 shadow-[0_20px_40px_rgba(234,88,12,0.4)]" 
                                : "bg-white text-black border-white/20 hover:bg-zinc-200"
                            )}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-shimmer" />
                            <span className="relative z-10">{room.votes[me.id] === player.id ? 'Проголосовано' : 'Голосовать'}</span>
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
          <div className={cn(
            "rounded-[3rem] p-10 space-y-10 shadow-2xl relative overflow-hidden flex flex-col border",
            theme.card,
            theme.border
          )} style={theme.handDrawn ? { borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px' } : {}}>
            <div className={cn("absolute top-0 right-0 w-40 h-40 blur-3xl rounded-full -mr-20 -mt-20 opacity-20", theme.accent.replace('text-', 'bg-'))} />
            
            <div className="space-y-6 relative z-10">
              <div className="flex items-center justify-between">
                <h3 className={cn("text-[10px] font-black uppercase tracking-[0.4em]", theme.muted)}>Статус игры</h3>
                <div className={cn("px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-widest", theme.card, theme.border, theme.muted)}>
                  {room.players.filter(p => p.isAlive).length} Живы
                </div>
              </div>

              {room.status === 'lobby' && room.host === peerRef.current?.id && (
                <div className="space-y-6">
                  <div className={cn("p-8 rounded-[2rem] border text-center space-y-4", theme.card, theme.border)}>
                    <Users className={cn("w-12 h-12 mx-auto", theme.muted)} />
                    <div className="space-y-1">
                      <p className={cn("text-sm font-bold", theme.text)}>Ожидание игроков...</p>
                      <p className={cn("text-[10px] uppercase tracking-widest", theme.muted)}>Нужно еще {Math.max(0, 5 - room.players.length)} для начала</p>
                    </div>
                    <div className={cn("w-full h-1.5 rounded-full overflow-hidden", theme.card)}>
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(room.players.length / 5) * 100}%` }}
                        className={cn("h-full transition-colors", theme.accent.replace('text-', 'bg-'))}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className={cn("text-[10px] font-black uppercase tracking-widest", theme.muted)}>Игра с ботами</p>
                    <div className={cn("p-4 rounded-2xl border space-y-4", theme.card, theme.border)}>
                      <div className="flex items-center justify-between">
                        <span className={cn("text-xs font-bold", theme.text)}>{botCount} ботов</span>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setBotCount(Math.max(4, botCount - 1))}
                            className={cn("w-8 h-8 rounded-lg border flex items-center justify-center hover:bg-white/5", theme.border)}
                          >
                            -
                          </button>
                          <button 
                            onClick={() => setBotCount(Math.min(11, botCount + 1))}
                            className={cn("w-8 h-8 rounded-lg border flex items-center justify-center hover:bg-white/5", theme.border)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => addBots(botCount)}
                          className={cn("py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest hover:bg-white/5", theme.border, theme.accent)}
                        >
                          Добавить
                        </button>
                        <button
                          onClick={removeBots}
                          className={cn("py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest hover:bg-zinc-900/40 text-red-500 border-red-500/20")}
                        >
                          Удалить всех
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className={cn("text-[10px] font-black uppercase tracking-widest", theme.muted)}>Персонажи</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'fruits', name: 'Фрукты' },
                        { id: 'vegetables', name: 'Овощи' }
                      ].map(set => (
                        <button
                          key={set.id}
                          onClick={() => updateCharacterSet(set.id as 'fruits' | 'vegetables')}
                          className={cn(
                            "p-4 rounded-2xl border text-center transition-all",
                            room.characterSet === set.id 
                              ? "bg-white/10 border-white/20" 
                              : "border-transparent hover:bg-white/5"
                          )}
                        >
                          <p className={cn("text-xs font-black uppercase tracking-wider", room.characterSet === set.id ? theme.accent : theme.text)}>{set.name}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className={cn("text-[10px] font-black uppercase tracking-widest", theme.muted)}>Режим игры</p>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: 'classic', name: 'Классика', desc: 'Стандартные правила' },
                        { id: 'blind', name: 'Вслепую', desc: 'Роли не раскрываются' },
                        { id: 'chaos', name: 'Рубилово', desc: '3 мафии (мин. 12 игроков)' },
                        { id: 'speedrun', name: 'Спидран', desc: 'Быстрая игра' },
                        { id: 'hardcore', name: 'Хардкор', desc: 'Без доктора и детектива' }
                      ].map(mode => (
                        <button
                          key={mode.id}
                          onClick={() => updateGameMode(mode.id as GameMode)}
                          className={cn(
                            "p-4 rounded-2xl border text-left transition-all group",
                            room.gameMode === mode.id 
                              ? "bg-white/10 border-white/20" 
                              : "border-transparent hover:bg-white/5"
                          )}
                        >
                          <p className={cn("text-xs font-black uppercase tracking-wider", room.gameMode === mode.id ? theme.accent : theme.text)}>{mode.name}</p>
                          <p className="text-[9px] font-medium opacity-40 group-hover:opacity-60 transition-opacity">{mode.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <motion.button
                    whileHover={{ 
                      scale: 1.02,
                      boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
                      y: -4
                    }}
                    whileTap={{ scale: 0.96, y: 0 }}
                    onClick={startGame}
                    disabled={room.players.length < (room.gameMode === 'chaos' ? 12 : 5)}
                    className={cn(
                      "w-full py-8 transition-all duration-300 rounded-[2rem] font-black uppercase italic tracking-tighter text-2xl shadow-2xl disabled:opacity-50 disabled:grayscale relative overflow-hidden group",
                      theme.accent.replace('text-', 'bg-'),
                      "text-white"
                    )}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:animate-shimmer" />
                    <span className="relative z-10">Начать игру</span>
                  </motion.button>
                </div>
              )}

              {room.status === 'playing' && me && (
                <div className={cn("p-8 rounded-[2rem] border space-y-4", theme.card, theme.border)}>
                  <div className="flex items-center justify-between">
                    <p className={cn("text-[10px] font-black uppercase tracking-widest", theme.muted)}>Ваша роль</p>
                  </div>
                  <div className={cn(
                    "p-4 rounded-xl border flex items-center gap-4 transition-all duration-500",
                    me.role === 'mafia' ? "border-red-500/20 bg-red-500/5" :
                    me.role === 'doctor' ? "border-green-500/20 bg-green-500/5" :
                    me.role === 'detective' ? "border-blue-500/20 bg-blue-500/5" :
                    "border-zinc-500/20 bg-zinc-500/5"
                  )}>
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", 
                      me.role === 'mafia' ? "bg-red-500/20 text-red-500" :
                      me.role === 'doctor' ? "bg-green-500/20 text-green-500" :
                      me.role === 'detective' ? "bg-blue-500/20 text-blue-500" :
                      "bg-zinc-500/20 text-zinc-500"
                    )}>
                      <Shield className="w-5 h-5" />
                    </div>
                    <span className={cn(
                      "text-xl font-black uppercase italic tracking-tighter",
                      me.role === 'mafia' ? "text-red-500" :
                      me.role === 'doctor' ? "text-green-500" :
                      me.role === 'detective' ? "text-blue-500" :
                      "text-zinc-500"
                    )}>
                      {ROLE_NAMES[me.role]}
                    </span>
                  </div>
                </div>
              )}

              {room.status === 'playing' && (
                <div className="space-y-6">
                  <div className={cn("p-10 rounded-[3rem] border-2 relative overflow-hidden group", theme.card, theme.border)}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-50" />
                    <div className="relative z-10 space-y-4">
                      <div className="flex items-center gap-4">
                        <div className={cn("p-4 rounded-2xl bg-white/5 border", theme.border)}>
                          {room.phase === 'night' ? <Moon className="w-8 h-8 text-indigo-400" /> : <Sun className="w-8 h-8 text-orange-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-4xl font-black uppercase italic tracking-tighter font-display break-words leading-[0.9]">{PHASE_NAMES[room.phase]}</h4>
                          <p className={cn("text-[10px] font-black uppercase tracking-[0.3em]", theme.muted)}>Фаза игры</p>
                        </div>
                      </div>
                      
                      <div className={cn("text-xs leading-relaxed font-medium", theme.text)}>
                        {room.phase === 'night' && (
                          <div className="space-y-4">
                            {me?.role === 'mafia' && (
                              <div className="space-y-3">
                                <p>Выберите цель для устранения вместе с другими членами Мафии.</p>
                                {room.players.filter(p => p.role === 'mafia' && p.isAlive).length > 1 && (
                                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                    <p className="text-[9px] text-red-400 font-black uppercase tracking-widest leading-relaxed">
                                      Внимание: Кто первый нажмет на цель, тот и делает ход за всю Мафию!
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                            {me?.role === 'doctor' && "Выберите, кого вы хотите защитить этой ночью."}
                            {me?.role === 'detective' && "Выберите игрока, чью роль вы хотите проверить."}
                            {me?.role === 'citizen' && "Город спит. Надейтесь, что Мафия не выберет вас."}
                            <div className="mt-6 flex flex-wrap gap-2">
                              {room.players.some(p => p.role === 'mafia' && p.isAlive && !room.nightActions.mafiaTarget) && (
                                <span className="px-3 py-1.5 bg-red-500/10 text-red-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-red-500/20">Мафия</span>
                              )}
                              {room.players.some(p => p.role === 'doctor' && p.isAlive && !room.nightActions.doctorTarget) && (
                                <span className="px-3 py-1.5 bg-green-500/10 text-green-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-green-500/20">Доктор</span>
                              )}
                              {room.players.some(p => p.role === 'detective' && p.isAlive && !room.nightActions.detectiveTarget) && (
                                <span className="px-3 py-1.5 bg-blue-500/10 text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-blue-500/20">Детектив</span>
                              )}
                            </div>
                          </div>
                        )}
                        {room.phase === 'day_results' && "Солнце встает. Город узнает, что произошло ночью."}
                        {room.phase === 'voting' && "Время обсуждения. Проголосуйте за того, кого подозреваете в причастности к Мафии."}
                        {room.phase === 'elimination' && "Голоса подсчитаны. Кто-то покидает игру."}
                      </div>
                    </div>
                  </div>

                  {room.host === peerRef.current?.id && (room.phase === 'night' || room.phase === 'day_results' || room.phase === 'day_discussion' || room.phase === 'elimination') && (
                    <motion.button
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={room.phase === 'night' ? skipNight : nextPhase}
                      className={cn(
                        "w-full py-8 transition-all rounded-[2rem] font-black uppercase tracking-[0.3em] text-[10px] shadow-2xl font-display",
                        theme.name === 'sasavot' ? "bg-red-600 text-white shadow-red-900/40" : "bg-white text-black shadow-white/10"
                      )}
                    >
                      {room.phase === 'night' ? 'Завершить ночь' : room.phase === 'day_results' ? 'Начать обсуждение' : room.phase === 'day_discussion' ? 'Открыть голосование' : 'Начать ночь'}
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
                      <h4 className={cn("text-4xl font-black uppercase italic tracking-tighter", theme.text)}>
                        {room.winner === 'mafia' ? 'Мафия победила' : 'Жители победили'}
                      </h4>
                      <p className={cn("text-[10px] font-black uppercase tracking-[0.3em]", theme.muted)}>Игра окончена</p>
                    </div>
                  </div>
                  
                  {room.host === peerRef.current?.id && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => window.location.reload()}
                      className={cn("w-full py-6 transition-all rounded-2xl font-black uppercase tracking-widest text-xs border", theme.card, theme.border, theme.text)}
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
                  <div className={cn("w-1 h-4 rounded-full", theme.accent.replace('text-', 'bg-'))} />
                  <h3 className={cn("text-[10px] font-black uppercase tracking-[0.5em]", theme.muted)}>Журнал событий</h3>
                </div>
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => <div key={i} className={cn("w-1 h-1 rounded-full", theme.card)} />)}
                </div>
              </div>
              <div className={cn("flex-1 rounded-[2.5rem] border p-8 overflow-y-auto custom-scrollbar space-y-4 shadow-inner ring-1 ring-white/5", theme.card, theme.border)}>
                {room.logs.slice().reverse().map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={i} 
                    className="flex gap-4 text-[11px] leading-relaxed group"
                  >
                    <span className={cn("font-mono shrink-0 opacity-50 group-hover:opacity-100 transition-opacity", theme.muted)}>
                      [{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]
                    </span>
                    <span className={cn(
                      "font-medium transition-colors flex-1 break-words",
                      log.type === 'danger' ? "text-red-400" : 
                      log.type === 'success' ? "text-green-400" : 
                      log.type === 'system' ? theme.accent : theme.muted
                    )}>
                      {log.message}
                    </span>
                  </motion.div>
                ))}
                {room.logs.length === 0 && (
                  <div className={cn("h-full flex flex-col items-center justify-center space-y-4", theme.muted)}>
                    <div className={cn("w-12 h-12 rounded-full border-2 border-dashed animate-[spin_10s_linear_infinite]", theme.border)} />
                    <p className="text-[10px] font-black uppercase tracking-[0.4em]">Событий пока нет</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Pause Overlay */}
      <AnimatePresence>
        {room.isPaused && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-10"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className={cn("max-w-2xl w-full rounded-[4rem] p-16 border-4 text-center space-y-12 shadow-[0_0_100px_rgba(0,0,0,0.5)]", theme.card, theme.border)}
            >
              <div className="space-y-6">
                <div className="relative inline-block">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                    className={cn("w-32 h-32 rounded-full border-4 border-dashed opacity-20", theme.border)}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className={cn("w-12 h-12 animate-spin", theme.accent)} />
                  </div>
                </div>
                <h2 className="text-6xl font-black italic uppercase tracking-tighter leading-none">
                  Ждем <span className={theme.accent}>{room.players.find(p => p.id === room.pausedBy)?.name || 'игрока'}</span>
                </h2>
                <p className={cn("text-sm font-black uppercase tracking-[0.4em] opacity-60", theme.muted)}>
                  Ожидание переподключения...
                </p>
              </div>

              <div className="space-y-4">
                <div className="text-8xl font-black tabular-nums tracking-tighter italic">
                  {Math.max(0, Math.ceil((20000 - (currentTime - (room.pauseTimer || 0))) / 1000))}
                </div>
                <div className={cn("w-full h-2 rounded-full overflow-hidden bg-white/5", theme.card)}>
                  <motion.div 
                    initial={{ width: "100%" }}
                    animate={{ width: "0%" }}
                    transition={{ duration: 20, ease: "linear" }}
                    className={cn("h-full", theme.accentBg)}
                  />
                </div>
              </div>

              {room.host === peerRef.current?.id && currentTime > (room.pauseTimer || 0) + 20000 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-2 gap-6 pt-8"
                >
                  <button 
                    onClick={continueGame}
                    className="py-6 bg-white text-black rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-zinc-200 transition-all shadow-xl"
                  >
                    Продолжить (без игрока)
                  </button>
                  <button 
                    onClick={restartGame}
                    className="py-6 bg-red-600 text-white rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-red-500 transition-all shadow-xl shadow-red-900/40"
                  >
                    Начать заново
                  </button>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {room && (
        <MusicPlayer 
          room={room} 
          peerId={peerRef.current?.id} 
          updateMusicSettings={updateMusicSettings} 
          theme={theme} 
        />
      )}

      {/* Floating Reaction Bar removed as requested */}

      {/* Phase Transition Overlay */}
      <AnimatePresence>
        {showPhaseOverlay && room && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-6 pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 200, rotateX: 90, filter: "blur(20px)" }}
              animate={{ scale: 1, opacity: 1, y: 0, rotateX: 0, filter: "blur(0px)" }}
              exit={{ scale: 1.2, opacity: 0, y: -100, rotateX: -45, filter: "blur(20px)" }}
              transition={{ 
                type: "spring", 
                damping: 12, 
                stiffness: 100,
                filter: { duration: 0.4 }
              }}
              className={cn(
                "w-full max-w-4xl border rounded-[4rem] shadow-[0_60px_150px_rgba(0,0,0,0.8)] p-12 flex flex-col items-center gap-10 relative overflow-hidden",
                theme.card,
                theme.border
              )}
            >
              {/* Animated background glows */}
              <motion.div 
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.2, 0.3, 0.2],
                  rotate: [0, 90, 0]
                }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className={cn(
                  "absolute -top-32 -left-32 w-80 h-80 blur-[120px] rounded-full",
                  room.phase === 'night' ? "bg-indigo-600" : "bg-orange-400"
                )} 
              />
              <motion.div 
                animate={{ 
                  scale: [1.2, 1, 1.2],
                  opacity: [0.2, 0.3, 0.2],
                  rotate: [0, -90, 0]
                }}
                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                className={cn(
                  "absolute -bottom-32 -right-32 w-80 h-80 blur-[120px] rounded-full",
                  room.phase === 'night' ? "bg-red-600" : "bg-yellow-400"
                )} 
              />

              <div className="flex flex-col sm:flex-row items-center gap-8 sm:gap-12 w-full relative z-10">
                <motion.div 
                  initial={{ rotate: -20, scale: 0.5 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ delay: 0.2, type: "spring" }}
                  className={cn(
                    "w-24 h-24 sm:w-32 sm:h-32 rounded-[2.5rem] flex items-center justify-center shadow-2xl border shrink-0 relative",
                    room.phase === 'night' ? "bg-indigo-600/20 border-indigo-500/30" : "bg-orange-500/20 border-orange-400/30"
                  )}
                >
                  <div className="absolute inset-0 bg-white/5 animate-pulse-slow rounded-[2.5rem]" />
                  {room.phase === 'night' && <Moon className="w-12 h-12 sm:w-16 sm:h-16 text-indigo-400 relative z-10" />}
                  {(room.phase === 'day_results' || room.phase === 'day_discussion') && <Sun className="w-12 h-12 sm:w-16 sm:h-16 text-orange-400 relative z-10" />}
                  {room.phase === 'voting' && <Vote className="w-12 h-12 sm:w-16 sm:h-16 text-red-400 relative z-10" />}
                  {room.phase === 'elimination' && <AlertCircle className="w-12 h-12 sm:w-16 sm:h-16 text-yellow-400 relative z-10" />}
                  {room.phase === 'game_over' && <Trophy className="w-12 h-12 sm:w-16 sm:h-16 text-yellow-500 relative z-10" />}
                  {room.phase === 'waiting' && <Users className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-400 relative z-10" />}
                </motion.div>

                <div className="flex flex-col items-center sm:items-start text-center sm:text-left min-w-0 flex-1">
                  <motion.h2 
                    initial={{ x: 50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className={cn(
                      "text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black uppercase italic tracking-tighter leading-none font-display whitespace-nowrap drop-shadow-2xl",
                      room.phase === 'night' ? "text-indigo-400" : theme.accent
                    )}
                  >
                    {PHASE_NAMES[room.phase]}
                  </motion.h2>
                  <motion.span 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.4 }}
                    transition={{ delay: 0.5 }}
                    className="text-[12px] font-black uppercase tracking-[0.6em] mt-4"
                  >
                    Фаза игры
                  </motion.span>
                </div>
              </div>

              <div className="w-full h-px bg-white/10 relative z-10" />

              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className={cn(
                  "text-xl md:text-2xl font-medium text-center leading-relaxed max-w-md relative z-10",
                  theme.muted
                )}
              >
                {PHASE_DESCRIPTIONS[room.phase]}
              </motion.p>

              <div className="w-full px-4 relative z-10">
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.4, duration: 1.2, ease: "circOut" }}
                  className={cn(
                    "h-2 w-full rounded-full overflow-hidden bg-white/5",
                  )}
                >
                  <motion.div 
                    initial={{ x: "-100%" }}
                    animate={{ x: "0%" }}
                    transition={{ duration: 2, ease: "linear" }}
                    className={cn(
                      "h-full w-full shadow-[0_0_20px_rgba(255,255,255,0.3)]",
                      room.phase === 'night' ? "bg-indigo-500" : theme.accentBg
                    )}
                  />
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Music Settings Modal */}
      <AnimatePresence>
        {showMusicSettings && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMusicSettings(false)}
              className="absolute inset-0 bg-black/80"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={cn("relative w-full max-w-2xl rounded-[3rem] border shadow-2xl overflow-hidden flex flex-col max-h-[80vh]", theme.card, theme.border)}
            >
              <div className={cn("p-10 border-b flex items-center justify-between", theme.border)}>
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl", theme.accentBg)}>
                    <Music className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black italic uppercase tracking-tighter">Настройки Музыки</h2>
                    <p className={cn("text-xs font-bold uppercase tracking-widest opacity-50", theme.muted)}>Управление атмосферой игры</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowMusicSettings(false)}
                  className="p-4 hover:bg-white/10 rounded-2xl transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
                {/* Controls for Host */}
                {room.host === peerRef.current?.id ? (
                  <div className="space-y-8">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <label className={cn("text-xs font-black uppercase tracking-widest opacity-50", theme.muted)}>Громкость</label>
                        <div className={cn("flex items-center gap-4 p-4 rounded-2xl border", theme.card, theme.border)}>
                          {room.musicSettings?.volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                          <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.01" 
                            value={room.musicSettings?.volume ?? 0.5}
                            onChange={(e) => updateMusicSettings({ volume: parseFloat(e.target.value) })}
                            className={cn("flex-1 accent-orange-500")}
                          />
                        </div>
                      </div>
                      <div className="space-y-4">
                        <label className={cn("text-xs font-black uppercase tracking-widest opacity-50", theme.muted)}>Повтор</label>
                        <button 
                          onClick={() => updateMusicSettings({ loop: !room.musicSettings?.loop })}
                          className={cn(
                            "w-full flex items-center justify-center gap-3 p-4 rounded-2xl border transition-all font-bold uppercase text-xs tracking-widest",
                            room.musicSettings?.loop ? "bg-orange-600 border-orange-500 text-white" : cn(theme.card, theme.border, "opacity-50")
                          )}
                        >
                          <Repeat className="w-4 h-4" />
                          {room.musicSettings?.loop ? 'Включен' : 'Выключен'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className={cn("text-xs font-black uppercase tracking-widest opacity-50", theme.muted)}>Плейлист</label>
                        <label className="cursor-pointer flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors">
                          <PlusCircle className="w-4 h-4" />
                          Добавить файл
                          <input type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
                        </label>
                      </div>
                      
                      <div className="space-y-2">
                        {!room.musicSettings?.playlist || room.musicSettings.playlist.length === 0 ? (
                          <div className={cn("py-10 text-center border-2 border-dashed rounded-3xl opacity-30", theme.border)}>
                            <p className="text-sm font-bold uppercase tracking-widest">Плейлист пуст</p>
                          </div>
                        ) : (
                          room.musicSettings?.playlist?.map((track) => (
                            <div 
                              key={track.id}
                              className={cn(
                                "flex items-center justify-between p-4 rounded-2xl border transition-all",
                                room.musicSettings?.currentTrackId === track.id ? "bg-orange-500/20 border-orange-500/50" : cn(theme.card, theme.border)
                              )}
                            >
                              <div className="flex items-center gap-4 overflow-hidden">
                                <button 
                                  onClick={() => {
                                    if (room.musicSettings?.currentTrackId === track.id) {
                                      updateMusicSettings({ isPlaying: !room.musicSettings?.isPlaying });
                                    } else {
                                      updateMusicSettings({ currentTrackId: track.id, isPlaying: true });
                                    }
                                  }}
                                  className="p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"
                                >
                                  {room.musicSettings?.currentTrackId === track.id && room.musicSettings?.isPlaying ? <Pause className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                                </button>
                                <div className="truncate">
                                  <p className="font-bold text-sm truncate">{track.name}</p>
                                  {track.suggestedByName && <p className={cn("text-[10px] opacity-40 uppercase font-black", theme.muted)}>От: {track.suggestedByName}</p>}
                                </div>
                              </div>
                              <button 
                                onClick={() => removeMusic(track.id)}
                                className="p-3 text-red-400 hover:bg-red-400/10 rounded-xl transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {room.musicSettings?.suggestions && room.musicSettings.suggestions.length > 0 && (
                      <div className="space-y-4">
                        <label className="text-xs font-black uppercase tracking-widest text-yellow-500/70">Предложения от игроков</label>
                        <div className="space-y-2">
                          {room.musicSettings?.suggestions?.map((track) => (
                            <div key={track.id} className="flex items-center justify-between p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl">
                              <div className="truncate">
                                <p className="font-bold text-sm truncate">{track.name}</p>
                                <p className={cn("text-[10px] opacity-40 uppercase font-black", theme.muted)}>От: {track.suggestedByName}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => acceptMusic(track.id)}
                                  className="p-3 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl transition-colors"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => declineMusic(track.id)}
                                  className="p-3 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // View for Players
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className={cn("text-xs font-black uppercase tracking-widest opacity-50", theme.muted)}>Плейлист</label>
                        <label className="cursor-pointer flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors">
                          <PlusCircle className="w-4 h-4" />
                          Предложить музыку
                          <input type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
                        </label>
                      </div>
                      <div className="space-y-2">
                        {!room.musicSettings?.playlist || room.musicSettings.playlist.length === 0 ? (
                          <div className={cn("py-10 text-center border-2 border-dashed rounded-3xl opacity-30", theme.border)}>
                            <p className="text-sm font-bold uppercase tracking-widest">Плейлист пуст</p>
                          </div>
                        ) : (
                          room.musicSettings?.playlist?.map((track) => (
                            <div 
                              key={track.id}
                              className={cn(
                                "flex items-center gap-4 p-4 rounded-2xl border transition-all",
                                room.musicSettings?.currentTrackId === track.id ? "bg-orange-500/20 border-orange-500/50" : cn(theme.card, theme.border)
                              )}
                            >
                              <div className="p-3 bg-white/10 rounded-xl">
                                <Music className="w-4 h-4" />
                              </div>
                              <div className="truncate">
                                <p className="font-bold text-sm truncate">{track.name}</p>
                                {track.suggestedByName && <p className={cn("text-[10px] opacity-40 uppercase font-black", theme.muted)}>От: {track.suggestedByName}</p>}
                              </div>
                              {room.musicSettings?.currentTrackId === track.id && room.musicSettings?.isPlaying && (
                                <div className="ml-auto flex gap-1">
                                  <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.5 }} className="w-1 bg-orange-400" />
                                  <motion.div animate={{ height: [8, 4, 8] }} transition={{ repeat: Infinity, duration: 0.5, delay: 0.1 }} className="w-1 bg-orange-400" />
                                  <motion.div animate={{ height: [12, 8, 12] }} transition={{ repeat: Infinity, duration: 0.5, delay: 0.2 }} className="w-1 bg-orange-400" />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

        @keyframes glitch {
          0% { transform: translate(0); }
          20% { transform: translate(-2px, 2px); }
          40% { transform: translate(-2px, -2px); }
          60% { transform: translate(2px, 2px); }
          80% { transform: translate(2px, -2px); }
          100% { transform: translate(0); }
        }

        .glitch-effect {
          animation: glitch 0.3s infinite;
          text-shadow: 2px 0 #ff00c1, -2px 0 #00fff9;
        }

        .hand-drawn {
          border-radius: 255px 15px 225px 15px/15px 225px 15px 255px;
          border: 2px solid currentColor;
        }
      `}</style>
    </div>
  );
}
