import { create } from "zustand";

export const useAuthStore = create((set, get) => ({
  isAppReady: true,
  appVersion: "1.0.0",

  initializeApp: async () => {
    try {
      console.log("PDF Editor app initialized");
      set({ isAppReady: true });
    } catch (error) {
      console.error("Error initializing app:", error);
    }
  },

  setAppReady: (ready) => set({ isAppReady: ready }),

  disconnectSocket: () => {
        if (get().socket?.connected) get().socket.disconnect();
    },
}));
    
