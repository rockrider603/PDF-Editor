import { create } from "zustand";

// Simple app store for PDF Editor - no authentication needed
export const useAuthStore = create((set, get) => ({
  // App state - no user authentication
  isAppReady: true,
  appVersion: "1.0.0",

  // Basic app initialization
  initializeApp: async () => {
    try {
      // Any app initialization logic can go here
      console.log("PDF Editor app initialized");
      set({ isAppReady: true });
    } catch (error) {
      console.error("Error initializing app:", error);
    }
  },

  // Utility functions for app state
  setAppReady: (ready) => set({ isAppReady: ready }),

  disconnectSocket: () => {
        if (get().socket?.connected) get().socket.disconnect();
    },
}));
    
