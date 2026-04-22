import Navbar from "./components/Navbar";

import UploadPage from "./pages/UploadPage";
import EditingPage from "./pages/EditingPage";

import { Routes, Route } from "react-router-dom";
import { useAuthStore } from "./store/useAuthStore";
import { useThemeStore } from "./store/useThemeStore";
import { useEffect } from "react";
import React from "react";
import { Toaster } from "react-hot-toast";

const App = () => {
  const { initializeApp, isAppReady } = useAuthStore();
  const { theme } = useThemeStore();

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  if (!isAppReady) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <span className="loading loading-lg"></span>
          <p className="mt-4 text-gray-600">Loading PDF Editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div data-theme={theme}>
      <Navbar />

      <Routes>
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/" element={<UploadPage />} />
        <Route path="/edit/:pdfid" element={<EditingPage />} />
      </Routes>

      <Toaster />
    </div>
  );
};

export default App;