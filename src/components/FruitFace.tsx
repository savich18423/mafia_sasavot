import React, { useEffect, useRef, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import { Shield, Target, Search, Skull, Heart, User, CheckCircle2, XCircle } from 'lucide-react';

interface FruitFaceProps {
  stream: MediaStream | null;
  fruitType: string;
  isLocal?: boolean;
  playerName: string;
  status?: 'protected' | 'targeted' | 'investigated_mafia' | 'investigated_citizen' | null;
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
  status 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!stream || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    video.srcObject = stream;

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    const fruitImg = new Image();
    fruitImg.src = FRUIT_IMAGES[fruitType] || FRUIT_IMAGES.orange;

    faceMesh.onResults((results) => {
      if (!ctx || !canvas) return;

      // 1. Fill background with fruit color
      ctx.fillStyle = FRUIT_COLORS[fruitType] || '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // Calculate face bounds for fruit placement
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        landmarks.forEach(point => {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        });

        const width = (maxX - minX) * canvas.width * 2.8; // Slightly larger fruit
        const height = (maxY - minY) * canvas.height * 2.8;
        const centerX = (minX + maxX) / 2 * canvas.width;
        const centerY = (minY + maxY) / 2 * canvas.height;

        // 2. Draw fruit image (Body)
        ctx.save();
        // Add a subtle shadow to the fruit itself
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 10;
        ctx.drawImage(fruitImg, centerX - width / 2, centerY - height / 2, width, height);
        ctx.restore();

        // 3. Cut out eyes and mouth (draw original video in these regions)
        const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
        const rightEyeIndices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
        const mouthIndices = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409];

        const drawMaskedRegion = (indices: number[], scale = 1.8, feather = 15) => {
          ctx.save();
          
          // Calculate center of the region
          let cx = 0, cy = 0;
          indices.forEach(idx => {
            cx += landmarks[idx].x * canvas.width;
            cy += landmarks[idx].y * canvas.height;
          });
          cx /= indices.length;
          cy /= indices.length;

          // Create the path for clipping with scaling
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

          // Draw a soft shadow/glow behind the hole for depth
          ctx.save();
          createPath(scale * 1.05);
          ctx.shadowBlur = feather;
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fill();
          ctx.restore();

          // Clipping for the video content
          ctx.save();
          createPath(scale);
          ctx.clip();
          
          // Draw the video frame, scaled to match the path
          ctx.translate(cx, cy);
          ctx.scale(scale, scale);
          ctx.translate(-cx, -cy);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          // Add a feathered edge overlay to blend video with fruit
          ctx.save();
          createPath(scale);
          ctx.strokeStyle = FRUIT_COLORS[fruitType] || '#000';
          ctx.lineWidth = feather;
          ctx.globalCompositeOperation = 'source-over';
          ctx.filter = `blur(${feather/2}px)`;
          ctx.stroke();
          ctx.restore();

          // Final sharp inner border for definition
          ctx.save();
          createPath(scale);
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          
          ctx.restore();
        };

        // Draw eyes and mouth with significant scaling for the iconic look
        // We use slightly different scales for eyes and mouth to balance the look
        drawMaskedRegion(leftEyeIndices, 1.9, 12);
        drawMaskedRegion(rightEyeIndices, 1.9, 12);
        drawMaskedRegion(mouthIndices, 1.7, 15);

      } else {
        // If no face, show fruit in center or dimmed video
        ctx.globalAlpha = 0.5;
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
        
        // Show a "waiting" fruit
        const w = 200, h = 200;
        ctx.drawImage(fruitImg, canvas.width/2 - w/2, canvas.height/2 - h/2, w, h);
      }
      setIsLoading(false);
    });

    let animationId: number;
    const processVideo = async () => {
      if (video.readyState >= 2) {
        await faceMesh.send({ image: video });
      }
      animationId = requestAnimationFrame(processVideo);
    };

    video.onloadedmetadata = () => {
      video.play();
      processVideo();
    };

    return () => {
      cancelAnimationFrame(animationId);
      faceMesh.close();
    };
  }, [stream, fruitType]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border-2 border-zinc-800">
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted={isLocal}
      />
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover"
        width={640}
        height={480}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-xs font-medium">
        {playerName} {isLocal && "(You)"}
      </div>

      {/* Status Icons Overlay */}
      {status && (
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {status === 'protected' && (
            <div className="p-2 bg-green-600 rounded-full shadow-lg shadow-green-900/40 animate-pulse">
              <Shield className="w-5 h-5 text-white" />
            </div>
          )}
          {status === 'targeted' && (
            <div className="p-2 bg-red-600 rounded-full shadow-lg shadow-red-900/40 animate-bounce">
              <Target className="w-5 h-5 text-white" />
            </div>
          )}
          {status === 'investigated_mafia' && (
            <div className="p-2 bg-orange-600 rounded-full shadow-lg shadow-orange-900/40">
              <Skull className="w-5 h-5 text-white" />
            </div>
          )}
          {status === 'investigated_citizen' && (
            <div className="p-2 bg-blue-600 rounded-full shadow-lg shadow-blue-900/40">
              <User className="w-5 h-5 text-white" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
