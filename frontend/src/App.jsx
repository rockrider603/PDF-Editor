import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Navbar from "./components/Navbar";
import UploadPage from "./pages/UploadPage";
import EditingPage from "./pages/EditingPage";

import { useThemeStore } from "./store/useThemeStore";

const App = () => {
  const { theme } = useThemeStore();
  return (
    <div data-theme={theme} className="min-h-screen transition-colors duration-300">
      <Navbar />

      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/edit" element={<EditingPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>

      <Toaster position="bottom-right" reverseOrder={false} />
    </div>
  );
};

export default App;