'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface AgentTerminalSuggestionProps {
  command: string;
  reason: string;
  onApprove: (command: string) => void;
  onReject: () => void;
}

export function AgentTerminalSuggestion({ command, reason, onApprove, onReject }: AgentTerminalSuggestionProps) {
  const [isApproved, setIsApproved] = useState(false);
  const [isRejected, setIsRejected] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'yes' | 'no'>('yes');

  const handleApprove = () => {
    setIsApproved(true);
    onApprove(command);
  };

  const handleReject = () => {
    setIsRejected(true);
    onReject();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (isApproved || isRejected) return;
      
      if (e.key === 'y' || e.key === 'Y' || e.key === 'ArrowRight') {
        handleApprove();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowLeft') {
        handleReject();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setSelectedOption(prev => prev === 'yes' ? 'no' : 'yes');
      } else if (e.key === 'Enter') {
        if (selectedOption === 'yes') {
          handleApprove();
        } else {
          handleReject();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isApproved, isRejected, selectedOption]);

  if (isApproved) {
    return (
      <div className="mt-1 py-1 text-xs text-green-600 dark:text-green-400 flex items-center animate-in fade-in-50 duration-150 ease-out">
        <span className="-ml-4 mr-2">✓</span>
        <span>Approved: $ {command}</span>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="mt-1 py-1 text-xs text-red-600 dark:text-red-400 flex items-center animate-in fade-in-50 duration-150 ease-out">
        <span className="-ml-4 mr-2">✗</span>
        <span>Rejected: $ {command}</span>
      </div>
    );
  }

  return (
    <div className="mt-1 py-1 text-xs text-muted-foreground animate-in fade-in-50 duration-150 ease-out">
      <span className="font-mono">$ {command}</span>
      <div className="flex gap-2 mt-1">
        <Button
          size="sm"
          variant={selectedOption === 'yes' ? 'default' : 'outline'}
          onClick={handleApprove}
          className="h-6 px-2 text-xs"
        >
          Yes (Y)
        </Button>
        <Button
          size="sm"
          variant={selectedOption === 'no' ? 'default' : 'outline'}
          onClick={handleReject}
          className="h-6 px-2 text-xs"
        >
          No (N)
        </Button>
      </div>
    </div>
  );
}
