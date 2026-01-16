
import React from 'react';

interface GigiAvatarProps {
  isSpeaking: boolean;
  isListening: boolean;
  status: string;
}

const GigiAvatar: React.FC<GigiAvatarProps> = ({ isSpeaking, isListening, status }) => {
  return (
    <div className="relative flex items-center justify-center w-64 h-64 mx-auto mb-12">
      {/* Pulse rings for listening */}
      {isListening && (
        <>
          <div className="absolute inset-0 bg-indigo-200 rounded-full animate-ping opacity-25"></div>
          <div className="absolute inset-4 bg-indigo-300 rounded-full animate-pulse opacity-40"></div>
        </>
      )}

      {/* Main Avatar Circle */}
      <div className={`
        relative z-10 w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500
        ${isSpeaking ? 'scale-110 shadow-2xl bg-indigo-600' : 'bg-indigo-500 shadow-xl'}
        ${status === 'ERROR' ? 'bg-red-500' : ''}
      `}>
        {/* Simple friendly face SVG */}
        <svg viewBox="0 0 100 100" className="w-24 h-24 text-white">
          <circle cx="35" cy="40" r="5" fill="currentColor" />
          <circle cx="65" cy="40" r="5" fill="currentColor" />
          <path 
            d={isSpeaking ? "M 30 70 Q 50 85 70 70" : "M 35 70 Q 50 75 65 70"} 
            stroke="currentColor" 
            strokeWidth="4" 
            fill="transparent" 
            strokeLinecap="round" 
          />
        </svg>
      </div>

      {/* Speaking indicator bars */}
      {isSpeaking && (
        <div className="absolute -bottom-8 flex gap-1 h-12 items-end">
          {[1, 2, 3, 4, 5].map((i) => (
            <div 
              key={i} 
              className="w-2 bg-indigo-500 rounded-full animate-bounce" 
              style={{ animationDelay: `${i * 0.1}s`, height: `${30 + Math.random() * 70}%` }}
            ></div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GigiAvatar;
