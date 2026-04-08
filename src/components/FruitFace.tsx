import React, { useEffect, useRef, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Shield, Target, Search, Skull, Heart, User, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

// Global lock to prevent concurrent FaceMesh initializations which cause "Module.arguments" errors
let isInitializingGlobal = false;
const initQueue: (() => void)[] = [];

const processQueue = () => {
  if (initQueue.length > 0) {
    const next = initQueue.shift();
    if (next) setTimeout(next, 100); // Add a small delay between initializations
  } else {
    isInitializingGlobal = false;
  }
};

interface FruitFaceProps {
  stream: MediaStream | null;
  fruitType: string;
  isLocal?: boolean;
  playerName: string;
  isAlive?: boolean;
  status?: 'protected' | 'targeted' | 'investigated_mafia' | 'investigated_citizen' | null;
  theme?: any;
  scale?: number;
}

const FRUIT_IMAGES: Record<string, string> = {
  watermelon: 'https://i.ibb.co/zVkVtrRv/png-clipart-watermelon-watermelon-thumbnail-removebg-preview.png',
  apple: 'https://pngicon.ru/file/uploads/apple.png',
  orange: 'https://pngicon.ru/file/uploads/2_55.png',
  pomelo: 'https://static.vecteezy.com/system/resources/previews/060/361/467/non_2x/fresh-green-pomelo-fruit-on-a-clean-transparent-background-ready-for-culinary-use-or-as-part-of-a-healthy-diet-fresh-green-pomelo-on-a-transparent-background-free-png.png',
  lemon: 'https://png.pngtree.com/png-vector/20251012/ourmid/pngtree-bright-yellow-lemon-fruit-png-image_17699581.webp',
  lime: 'https://imgpng.ru/d/lime_PNG52.png',
  guava: 'https://png.klev.club/uploads/posts/2024-05/thumbs/png-klev-club-4ae4-p-guava-png-26.png',
  apricot: 'https://pngicon.ru/file/uploads/abrikos.png',
  tangerine: 'https://png.klev.club/uploads/posts/2024-04/png-klev-club-owl2-p-mandarin-png-10.png',
  banana: 'https://pngimg.com/uploads/banana/banana_PNG825.png',
  pineapple: 'https://free-png.ru/wp-content/uploads/2022/02/free-png.ru-67-222x370.png',
  mango: 'https://png.pngtree.com/png-vector/20241221/ourmid/pngtree-ripe-mango-on-transparent-background-png-image_14848777.png',
  // Vegetables
  tomato: 'https://pngicon.ru/file/uploads/1303507287_Tomato.png',
  pumpkin: 'https://free-png.ru/wp-content/uploads/2022/02/free-png.ru-453.png',
  cucumber: 'https://avatanplus.com/files/resources/original/59c610ee72ce515eadb22386.png',
  pattypan: 'https://png.pngtree.com/png-vector/20250808/ourmid/pngtree-pattypan-squash-isolated-on-a-transparent-background-png-image_16739120.webp',
  turnip: 'https://purepng.com/public/uploads/large/purepng.com-turnipvegetablesroot-vegetable-rutabaga-turnip-neep-941524702929wkfry.png',
  pepper: 'https://gallery.yopriceville.com/downloadfullsize/send/10651',
  zucchini: 'https://pngimg.com/uploads/marrow/marrow_PNG24.png',
  eggplant: 'https://imgpng.ru/d/eggplant_PNG2763.png',
  cabbage: 'https://imgpng.ru/d/cabbage_PNG8787.png',
  potato: 'https://png.klev.club/uploads/posts/2024-04/png-klev-club-j750-p-kartofel-png-1.png',
  onion: 'https://free-png.ru/wp-content/uploads/2022/02/free-png.ru-332.png',
};

const FRUIT_COLORS: Record<string, string> = {
  watermelon: '#FC6C85',
  apple: '#FF0800',
  orange: '#FF8C00',
  grapefruit: '#FF7F50',
  pomelo: '#D1E231',
  lemon: '#FFF700',
  lime: '#32CD32',
  guava: '#98FB98',
  apricot: '#FBCEB1',
  tangerine: '#FF8C00',
  strawberry: '#FF2D55',
  blueberry: '#4F86F7',
  cherry: '#D2042D',
  banana: '#FFE135',
  pineapple: '#FFD700',
  mango: '#FF8243',
  // Vegetables
  tomato: '#FF6347',
  pumpkin: '#FF7518',
  cucumber: '#2E8B57',
  pattypan: '#F0E68C',
  turnip: '#E6E6FA',
  pepper: '#FF0000',
  zucchini: '#556B2F',
  eggplant: '#4B0082',
  cabbage: '#90EE90',
  potato: '#D2B48C',
  onion: '#E0C090',
};

export const FruitFace: React.FC<FruitFaceProps> = ({ 
  stream, 
  fruitType, 
  isLocal, 
  playerName,
  isAlive = true,
  status,
  theme,
  scale = 3.2
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const fruitTypeRef = useRef(fruitType);
  const [isLoading, setIsLoading] = useState(true);
  const [isFaceMeshReady, setIsFaceMeshReady] = useState(false);

  // Sync fruitType to ref
  useEffect(() => {
    fruitTypeRef.current = fruitType;
  }, [fruitType]);

  // Initialize FaceMesh once on mount
  useEffect(() => {
    let isMounted = true;
    let faceMesh: FaceMesh | null = null;

    const performInit = async () => {
      try {
        faceMesh = new FaceMesh({
          locateFile: (file) => {
            // Use a stable CDN path. Removing the specific version from the URL string 
            // can sometimes help with internal loader consistency if it expects relative paths.
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
          },
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: false, // Disable for better performance
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results) => {
          if (!isMounted || !canvasRef.current) return;
          setIsLoading(false); // Ensure loading is off once we get results
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          const currentFruit = fruitTypeRef.current;
          const fruitImg = new Image();
          fruitImg.src = FRUIT_IMAGES[currentFruit] || FRUIT_IMAGES.orange;

          // 1. Draw camera feed as background instead of solid color
          ctx.save();
          ctx.filter = 'blur(10px) brightness(0.6)'; // Blur background to make fruit pop
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          // 2. Add a slight tint of the fruit color to the background
          ctx.fillStyle = (FRUIT_COLORS[currentFruit] || '#000000') + '33'; // 20% opacity tint
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            
            let minX = 1, minY = 1, maxX = 0, maxY = 0;
            landmarks.forEach(point => {
              minX = Math.min(minX, point.x);
              minY = Math.min(minY, point.y);
              maxX = Math.max(maxX, point.x);
              maxY = Math.max(maxY, point.y);
            });

            const faceWidth = (maxX - minX) * canvas.width;
            const faceHeight = (maxY - minY) * canvas.height;
            // Reduced scaling to fit better in the camera view
            const width = faceWidth * scale + canvas.width * 0.1;
            const height = faceHeight * scale + canvas.height * 0.1;
            const centerX = (minX + maxX) / 2 * canvas.width;
            const centerY = (minY + maxY) / 2 * canvas.height;

            ctx.save();
            // Simplified drawing for performance
            ctx.drawImage(fruitImg, centerX - width / 2, centerY - height / 2, width, height);
            ctx.restore();

            const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
            const rightEyeIndices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
            // Full mouth indices including inner and outer lips for a "fuller" look
            const mouthIndices = [
              61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, // Outer
              78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95 // Inner
            ];

            const drawMaskedRegion = (indices: number[], scale = 2.0, feather = 8, tintColor?: string) => {
              ctx.save();
              let cx = 0, cy = 0;
              indices.forEach(idx => {
                cx += landmarks[idx].x * canvas.width;
                cy += landmarks[idx].y * canvas.height;
              });
              cx /= indices.length;
              cy /= indices.length;

              const createPath = (s: number) => {
                ctx.beginPath();
                indices.forEach((idx, i) => {
                  const p = landmarks[idx];
                  const px = cx + (p.x * canvas.width - cx) * s;
                  const py = cy + (p.y * canvas.height - cy) * s;
                  if (i === 0) ctx.moveTo(px, py);
                  else ctx.lineTo(px, py);
                });
                ctx.closePath();
              };

              ctx.save();
              createPath(scale * 1.15);
              ctx.shadowBlur = 0; // Disable expensive shadow blur
              ctx.fillStyle = 'rgba(0,0,0,0.8)';
              ctx.fill();
              ctx.restore();

              ctx.save();
              createPath(scale);
              ctx.clip();
              ctx.translate(cx, cy);
              ctx.scale(scale, scale);
              ctx.translate(-cx, -cy);
              ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
              
              if (tintColor) {
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = tintColor;
                ctx.globalAlpha = 0.1; // Reduced alpha for faster blending
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 1.0;
                ctx.globalCompositeOperation = 'source-over';
              }
              ctx.restore();

              ctx.save();
              createPath(scale);
              ctx.strokeStyle = FRUIT_COLORS[currentFruit] || '#000';
              ctx.lineWidth = 2; // Simpler stroke without filter
              ctx.stroke();
              ctx.restore();

              ctx.save();
              createPath(scale);
              ctx.strokeStyle = 'rgba(0,0,0,0.3)';
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.restore();
              
              ctx.restore();
            };

            const tint = FRUIT_COLORS[currentFruit];
            // Adjusted mask scaling for the new fruit size
            drawMaskedRegion(leftEyeIndices, 2.1, 6, tint);
            drawMaskedRegion(rightEyeIndices, 2.1, 6, tint);
            drawMaskedRegion(mouthIndices, 1.9, 10, tint);

          } else {
            // Draw camera feed even when no face is detected
            ctx.save();
            ctx.filter = 'blur(10px) brightness(0.4)';
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            ctx.restore();
            
            // Draw a large "waiting" fruit
            const w = canvas.width * 0.6;
            const h = (w / fruitImg.width) * fruitImg.height || canvas.height * 0.6;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 40;
            ctx.globalAlpha = 0.8;
            ctx.drawImage(fruitImg, canvas.width/2 - w/2, canvas.height/2 - h/2, w, h);
            ctx.restore();
          }
        });

        // Wait for the internal WASM to actually load before proceeding
        // This is a bit of a hack but helps with stability
        if (typeof (faceMesh as any).initialize === 'function') {
          await (faceMesh as any).initialize();
        }

        if (isMounted) {
          faceMeshRef.current = faceMesh;
          setIsFaceMeshReady(true);
          setIsLoading(false); // Set loading to false once initialized
        }
      } catch (err) {
        console.error("Failed to initialize FaceMesh:", err);
        if (isMounted) setIsLoading(false);
      } finally {
        processQueue();
      }
    };

    const startInit = () => {
      if (isInitializingGlobal) {
        initQueue.push(performInit);
      } else {
        isInitializingGlobal = true;
        performInit();
      }
    };

    startInit();

    return () => {
      isMounted = false;
      if (faceMesh) {
        faceMesh.close();
      }
      faceMeshRef.current = null;
    };
  }, []); // Only once on mount

  useEffect(() => {
    if (!stream || !videoRef.current || !faceMeshRef.current || !isFaceMeshReady) {
      return;
    }

    const video = videoRef.current;
    video.srcObject = stream;
    
    const playVideo = async () => {
      try {
        if (video.paused) {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            await playPromise;
          }
        }
      } catch (err: any) {
        // AbortError is expected if the component unmounts or stream changes
        if (err.name !== 'AbortError') {
          console.error('Error playing video:', err);
        }
      }
    };
    
    playVideo();

    let animationId: number;
    let lastProcessTime = 0;
    // Increase interval for remote players to save CPU, keep local smooth
    const FRAME_INTERVAL = isLocal ? 33 : 66; 

    const processVideo = async (now: number) => {
      if (video.readyState >= 2 && faceMeshRef.current && (now - lastProcessTime >= FRAME_INTERVAL)) {
        try {
          lastProcessTime = now;
          await faceMeshRef.current.send({ image: video });
        } catch (err) {
          console.warn('FaceMesh processing warning:', err);
        }
      }
      animationId = requestAnimationFrame(processVideo);
    };

    if (video.readyState >= 2) {
      processVideo(performance.now());
    }

    video.onloadedmetadata = () => {
      playVideo();
      processVideo(performance.now());
    };

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [stream, isFaceMeshReady]);

  return (
    <div className={cn(
      "relative w-full aspect-[3/4] bg-black rounded-[3rem] overflow-hidden border-4 transition-all duration-700",
      !isAlive ? "grayscale opacity-40 border-red-900/30" : (theme?.border || 'border-zinc-800'),
      isAlive && "hover:scale-[1.02] hover:shadow-[0_0_50px_rgba(0,0,0,0.5)]"
    )}>
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        autoPlay
        muted={isLocal}
      />
      <canvas
        ref={canvasRef}
        className={cn(
          "w-full h-full object-cover transition-all duration-1000",
          !isAlive && "sepia brightness-50"
        )}
        width={400}
        height={533}
      />

      {/* Dead Overlay */}
      {!isAlive && (
        <div className="absolute inset-0 flex items-center justify-center z-40 bg-black/20 backdrop-blur-[1px]">
          <motion.div
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            className="p-8 rounded-full bg-black/60 border-4 border-white/10 shadow-2xl"
          >
            <Skull className="w-24 h-24 text-white/20" />
          </motion.div>
        </div>
      )}

      {/* Player Info Overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/95 via-black/60 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-2.5 h-2.5 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]",
              !isAlive ? "bg-zinc-700" : (isLocal ? 'bg-green-500 animate-pulse' : 'bg-orange-500 animate-pulse')
            )} />
            <div className="flex flex-col">
              <span className={cn(
                "text-lg font-black uppercase tracking-widest truncate max-w-[180px] font-display",
                !isAlive ? "text-zinc-500" : (theme?.text || 'text-white')
              )}>
                {playerName}
              </span>
              {isLocal && <span className="text-[8px] font-black uppercase tracking-widest text-white/40 -mt-1">Это вы</span>}
            </div>
          </div>
          
          {status && isAlive && (
            <div className="flex gap-3">
              {status === 'protected' && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="p-2 bg-green-500/20 rounded-xl border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                  <Shield className="w-5 h-5 text-green-400" />
                </motion.div>
              )}
              {status === 'targeted' && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="p-2 bg-red-500/20 rounded-xl border border-red-500/30 shadow-[0_0_15px_rgba(220,38,38,0.3)]">
                  <Target className="w-5 h-5 text-red-400 animate-pulse" />
                </motion.div>
              )}
              {status === 'investigated_mafia' && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="p-2 bg-red-600/20 rounded-xl border border-red-600/30 shadow-[0_0_15px_rgba(220,38,38,0.3)]">
                  <Skull className="w-5 h-5 text-red-500" />
                </motion.div>
              )}
              {status === 'investigated_citizen' && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="p-2 bg-green-600/20 rounded-xl border border-green-600/30 shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                  <Heart className="w-5 h-5 text-green-500" />
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status Overlays */}
      <AnimatePresence>
        {status === 'targeted' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 border-[12px] border-red-600/50 animate-pulse pointer-events-none z-20 shadow-[inset_0_0_100px_rgba(220,38,38,0.4)]" 
          />
        )}
        {status === 'protected' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 border-[12px] border-green-400/30 pointer-events-none z-20 shadow-[inset_0_0_100px_rgba(34,197,94,0.2)]" 
          />
        )}
        {status === 'investigated_mafia' && (
          <motion.div 
            initial={{ opacity: 0, scale: 2 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center z-30 bg-red-950/40 backdrop-blur-[2px]"
          >
            <Skull className="w-32 h-32 text-red-600 filter drop-shadow-[0_0_20px_rgba(220,38,38,0.8)]" />
          </motion.div>
        )}
        {status === 'investigated_citizen' && (
          <motion.div 
            initial={{ opacity: 0, scale: 2 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center z-30 bg-green-950/20 backdrop-blur-[2px]"
          >
            <Heart className="w-32 h-32 text-green-500 filter drop-shadow-[0_0_20px_rgba(34,197,94,0.8)]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
