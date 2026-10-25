import React, { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, FileText, Loader2, Sparkles, AlertCircle, RotateCw } from "lucide-react";
import { Message } from "../types";

interface AudioPlayerProps {
  message: Message;
  isDark: boolean;
  onTranscribe: (messageId: string) => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ message, isDark, onTranscribe }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [hasError, setHasError] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Generate deterministic waveform heights based on message ID so it doesn't flicker
  const waveformBars = useMemo(() => {
    const barsCount = 28;
    const str = message.id || "audio";
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Array.from({ length: barsCount }, (_, idx) => {
      const val = Math.abs(Math.sin(hash + idx * 7.9) * 22) + 6;
      return Math.floor(val);
    });
  }, [message.id]);

  const initAudio = () => {
    if (!message.fileUrl) return;
    setHasError(false);
    setIsLoadingAudio(true);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    const audio = new Audio(message.fileUrl);
    audio.playbackRate = playbackSpeed;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setIsLoadingAudio(false);
      setDuration(audio.duration || 0);
    };

    const handleCanPlay = () => {
      setIsLoadingAudio(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = (e: any) => {
      console.warn(`Audio playback error for message ${message.id}:`, e);
      setIsLoadingAudio(false);
      setIsPlaying(false);
      setHasError(true);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  };

  useEffect(() => {
    const cleanup = initAudio();
    return () => {
      cleanup?.();
    };
  }, [message.fileUrl]);

  const togglePlay = () => {
    if (!audioRef.current) {
      initAudio();
    }
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackSpeed;
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setHasError(false);
        })
        .catch((err) => {
          console.warn("Failed to play audio:", err);
          setHasError(true);
          setIsPlaying(false);
        });
    }
  };

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const speeds = [1, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const newSpeed = speeds[nextIdx];
    setPlaybackSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const newPercentage = Math.max(0, Math.min(1, clickX / width));
    const newTime = newPercentage * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || time <= 0) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 min-w-[240px] md:min-w-[290px]">
      <div className="flex items-center gap-3">
        {/* Play / Pause button */}
        <button
          onClick={togglePlay}
          className={`flex items-center justify-center w-10 h-10 rounded-full transition-all shrink-0 cursor-pointer shadow-sm ${
            message.sender === "me"
              ? isDark
                ? "bg-[#005c4b] text-white hover:bg-[#007560]"
                : "bg-[#00a884] text-white hover:bg-[#01755b]"
              : isDark
                ? "bg-[#202c33] text-[#00a884] hover:bg-[#2a3942]"
                : "bg-white text-[#00a884] hover:bg-gray-100"
          }`}
          id={`play-pause-btn-${message.id}`}
          title={isPlaying ? "Pause voice note" : "Play voice note"}
        >
          {isLoadingAudio ? (
            <Loader2 size={18} className="animate-spin" />
          ) : isPlaying ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" className="ml-0.5" />
          )}
        </button>

        {/* Waveform Visualization */}
        <div className="flex-1 flex flex-col gap-1 justify-center">
          <div
            onClick={handleProgressBarClick}
            className="flex items-end gap-[2px] h-8 cursor-pointer relative select-none py-1"
          >
            {waveformBars.map((barHeight, idx) => {
              const barProgress = (idx / waveformBars.length) * 100;
              const isPlayed = barProgress <= progressPercentage;

              let barColor = "bg-gray-300 dark:bg-gray-600";
              if (isPlayed) {
                barColor = message.sender === "me" ? "bg-emerald-800 dark:bg-white" : "bg-[#00a884]";
              }

              return (
                <div
                  key={idx}
                  className={`w-[3px] rounded-t-sm transition-colors ${barColor}`}
                  style={{ height: `${barHeight}px` }}
                />
              );
            })}
          </div>

          <div className="flex justify-between items-center text-[10px] opacity-75 font-mono">
            <span>{currentTime > 0 ? formatTime(currentTime) : (message.voiceDuration || "0:00")}</span>
            <div className="flex items-center gap-2">
              <span>{message.voiceDuration || (duration > 0 ? formatTime(duration) : "")}</span>
              {/* WhatsApp Playback Speed Pill */}
              <button
                onClick={cycleSpeed}
                className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-black/10 dark:bg-white/10 hover:bg-black/15 transition-colors cursor-pointer select-none"
                title="Change playback speed (1x, 1.5x, 2x)"
              >
                {playbackSpeed}x
              </button>
            </div>
          </div>
        </div>
      </div>

      {hasError && (
        <div className="flex items-center justify-between text-[11px] text-red-500 bg-red-500/10 px-2 py-1 rounded">
          <span className="flex items-center gap-1">
            <AlertCircle size={12} /> অডিও লোড করতে সমস্যা হয়েছে
          </span>
          <button
            onClick={() => initAudio()}
            className="flex items-center gap-1 font-semibold underline cursor-pointer"
          >
            <RotateCw size={10} /> পুনরায় চেষ্টা করুন
          </button>
        </div>
      )}

      {/* Transcription Layer */}
      <div className="mt-0.5 border-t border-black/10 dark:border-white/10 pt-1.5 flex flex-col gap-1">
        {message.transcription ? (
          <div className="bg-black/5 dark:bg-white/5 rounded p-2 text-xs leading-relaxed italic border-l-2 border-[#00a884]">
            <div className="flex items-center gap-1 font-semibold text-[10px] text-[#00a884] uppercase mb-1 tracking-wider">
              <Sparkles size={10} /> Transcription
            </div>
            "{message.transcription}"
          </div>
        ) : message.isTranscribing ? (
          <div className="flex items-center gap-1.5 text-xs opacity-75">
            <Loader2 size={12} className="animate-spin text-[#00a884]" />
            <span>ভয়েস নোট ট্রান্সক্রাইব হচ্ছে...</span>
          </div>
        ) : (
          <button
            onClick={() => onTranscribe(message.id)}
            className="flex items-center gap-1 text-[11px] font-medium text-[#00a884] dark:text-[#53bdeb] hover:underline self-start cursor-pointer"
            id={`transcribe-btn-${message.id}`}
          >
            <FileText size={12} />
            <span>ভয়েস টেক্সটে রূপান্তর করুন (Transcribe)</span>
          </button>
        )}
      </div>
    </div>
  );
};

