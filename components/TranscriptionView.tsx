
import React, { useEffect, useRef } from 'react';
import { TranscriptionPart } from '../types';

interface TranscriptionViewProps {
  items: TranscriptionPart[];
}

const TranscriptionView: React.FC<TranscriptionViewProps> = ({ items }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [items]);

  return (
    <div 
      ref={scrollRef}
      className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto px-4 md:px-8 py-6 space-y-6 bg-white/40 rounded-[2rem] border border-indigo-50 shadow-inner"
    >
      {items.length === 0 ? (
        <p className="text-indigo-300 text-center italic text-xl md:text-2xl mt-8">
          Aștept să povestim...
        </p>
      ) : (
        items.map((item, idx) => (
          <div 
            key={idx} 
            className={`flex ${item.isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            <div className={`
              max-w-[90%] md:max-w-[85%] px-5 py-3 md:px-8 md:py-5 rounded-[1.5rem] md:rounded-[2rem] senior-text shadow-sm
              ${item.isUser 
                ? 'bg-white text-indigo-900 border border-indigo-100 rounded-br-none' 
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
