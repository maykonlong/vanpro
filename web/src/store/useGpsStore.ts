import { create } from 'zustand';

interface GpsState {
  lat: number | null;
  lng: number | null;
  lastUpdated: string | null;
  isSimulating: boolean;
  setCoordinates: (lat: number, lng: number) => void;
  startSimulation: () => void;
  stopSimulation: () => void;
}

export const useGpsStore = create<GpsState>((set) => ({
  lat: null,
  lng: null,
  lastUpdated: null,
  isSimulating: false,
  setCoordinates: (lat, lng) => set({ lat, lng, lastUpdated: new Date().toISOString() }),
  startSimulation: () => set({ isSimulating: true }),
  stopSimulation: () => set({ isSimulating: false, lat: null, lng: null })
}));
