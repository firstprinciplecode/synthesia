import { create } from 'zustand';

interface UIState {
  rightOpen: boolean;
  rightTab: 'participants'|'tasks';
  setRightOpen: (v: boolean) => void;
  setRightTab: (t: 'participants'|'tasks') => void;
}

export const useUIStore = create<UIState>((set) => ({
  rightOpen: false,
  rightTab: 'participants',
  setRightOpen: (v) => set({ rightOpen: v }),
  setRightTab: (t) => set({ rightTab: t }),
}));


