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
  status?: 'protected' | 'targeted' | 'investigated_mafia' | 'investigated_citizen' | null;
  theme?: any;
}

const FRUIT_IMAGES: Record<string, string> = {
  watermelon: 'https://i.ibb.co/zVkVtrRv/png-clipart-watermelon-watermelon-thumbnail-removebg-preview.png',
  apple: 'https://pngicon.ru/file/uploads/apple.png',
  orange: 'https://pngicon.ru/file/uploads/2_55.png',
  grapefruit: 'https://imgpng.ru/d/grapefruit_PNG15258.png',
  pomelo: 'https://static.vecteezy.com/system/resources/previews/060/361/467/non_2x/fresh-green-pomelo-fruit-on-a-clean-transparent-background-ready-for-culinary-use-or-as-part-of-a-healthy-diet-fresh-green-pomelo-on-a-transparent-background-free-png.png',
  lemon: 'https://png.pngtree.com/png-clipart/20240220/original/pngtree-lemon-on-white-background-fruit-photo-png-image_14363893.png',
  lime: 'https://imgpng.ru/d/lime_PNG52.png',
  guava: 'https://png.klev.club/uploads/posts/2024-05/thumbs/png-klev-club-4ae4-p-guava-png-26.png',
  apricot: 'https://pngicon.ru/file/uploads/abrikos.png',
  tangerine: 'https://png.pngtree.com/png-clipart/20250212/original/pngtree-tangerine-fruit-png-image_20422728.png',
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
};

export const FruitFace: React.FC<FruitFaceProps> = ({ 
  stream, 
  fruitType, 
  isLocal, 
  playerName,
  status,
  theme
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

          // 1. Fill background with fruit color
          ctx.fillStyle = FRUIT_COLORS[currentFruit] || '#000000';
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

            const width = (maxX - minX) * canvas.width * 3.5;
            const height = (maxY - minY) * canvas.height * 3.5;
            const centerX = (minX + maxX) / 2 * canvas.width;
            const centerY = (minY + maxY) / 2 * canvas.height;

            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetY = 10;
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
            drawMaskedRegion(leftEyeIndices, 2.2, 6, tint);
            drawMaskedRegion(rightEyeIndices, 2.2, 6, tint);
            drawMaskedRegion(mouthIndices, 2.0, 10, tint);

          } else {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1.0;
            const w = 200, h = 200;
            ctx.drawImage(fruitImg, canvas.width/2 - w/2, canvas.height/2 - h/2, w, h);
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
        if (video.paused) await video.play();
      } catch (err) {
        console.error('Error playing video:', err);
      }
    };
    
    playVideo();

    let animationId: number;
    let lastProcessTime = 0;
    const FRAME_INTERVAL = 40; // ~25fps

    const processVideo = async (now: number) => {
      if (video.readyState >= 2 && faceMeshRef.current && (now - lastProcessTime >= FRAME_INTERVAL)) {
        try {
          lastProcessTime = now;
          await faceMeshRef.current.send({ image: video });
        } catch (err) {
          // Ignore processing errors to prevent crash loop
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
      "relative w-full aspect-[3/4] bg-black rounded-[3rem] overflow-hidden border-4 transition-all duration-500",
      theme?.border || 'border-zinc-800'
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
        className="w-full h-full object-cover"
        width={600}
        height={800}
      />

      {/* Player Info Overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full animate-pulse ${isLocal ? 'bg-green-500' : 'bg-orange-500'}`} />
            <span className={`text-sm font-black uppercase tracking-widest truncate max-w-[120px] ${theme?.text || 'text-white'}`}>
              {playerName} {isLocal && '(Вы)'}
            </span>
          </div>
          
          {status && (
            <div className="flex gap-2">
              {status === 'protected' && <Shield className="w-4 h-4 text-green-400" />}
              {status === 'targeted' && <Target className="w-4 h-4 text-red-400 animate-pulse" />}
              {status === 'investigated_mafia' && <Skull className="w-4 h-4 text-red-500" />}
              {status === 'investigated_citizen' && <Heart className="w-4 h-4 text-green-500" />}
            </div>
          )}
        </div>
      </div>

      {/* Status Overlays */}
      {status === 'targeted' && (
        <div className="absolute inset-0 border-4 border-red-600/50 animate-pulse pointer-events-none z-20" />
      )}
      {status === 'protected' && (
        <div className="absolute inset-0 border-4 border-green-400/30 pointer-events-none z-20" />
      )}
    </div>
  );
};
