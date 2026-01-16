
import React, { useEffect, useRef } from 'react';
import { TranscriptionPart } from '../types';

interface TranscriptionViewProps {
  items: TranscriptionPart[];
}

const TranscriptionView: React.FC<TranscriptionViewProps> = ({ items }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  return (
    <div 
      ref={scrollRef}
      className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto px-6 py-8 space-y-8 bg-white/50 rounded-3xl border border-indigo-50 shadow-inner"
      style={{ maxHeight: '40vh' }}
    >
      {items.length === 0 ? (
        <p className="text-indigo-300 text-center italic text-2xl mt-12">
          Gigi așteaptă să stăm de vorbă...
        </p>
      ) : (
        items.map((item, idx) => (
          <div 
            key={idx} 
            className={`flex ${item.isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
          >
            <div className={`
              max-w-[85%] px-8 py-5 rounded-3xl senior-text shadow-sm
              ${item.isUser 
                ? 'bg-white text-indigo-900 border-2 border-indigo-100 rounded-br-none' 
                : 'bg-indigo-600 text-white rounded-bl-none'}
            `}>
              {item.text}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default TranscriptionView;
