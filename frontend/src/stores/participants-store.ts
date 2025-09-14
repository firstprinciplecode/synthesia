import { create } from 'zustand';

export type Participant = { id: string; type: 'user'|'agent'; name: string; avatar?: string | null; status?: string };

interface ParticipantsState {
  byRoom: Record<string, Participant[]>;
  setRoomParticipants: (roomId: string, list: Participant[]) => void;
  getParticipants: (roomId: string) => Participant[];
}

export const useParticipantsStore = create<ParticipantsState>((set, get) => ({
  byRoom: {},
  setRoomParticipants: (roomId, list) => set({ byRoom: { ...get().byRoom, [roomId]: list } }),
  getParticipants: (roomId) => get().byRoom[roomId] || [],
}));


