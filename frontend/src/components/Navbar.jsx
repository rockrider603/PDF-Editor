import { Sun, Moon, Home, Upload, Menu, X, FileText, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useThemeStore } from "../store/useThemeStore";
import { useState } from "react";
import React from "react";
const Navbar = () => {
  const { theme, setTheme } = useThemeStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  
  const authUser = true; 
  const handleLogout = () => {
    console.log("Logging out...");
    setIsMenuOpen(false);
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const isActive = (path) => location.pathname === path;

  return (
    <nav className="navbar bg-base-200 shadow-lg relative">
      <div className="flex-1">
        <Link to="/" className="btn btn-ghost text-xl font-bold gap-2">
          <FileText size={24} />
          PDF Editor
        </Link>
      </div>

      {/* Desktop Navigation */}
      <div className="flex-none gap-2 hidden md:flex">
        <Link
          to="/"
          className={`btn btn-sm btn-ghost gap-2 ${isActive("/") ? "btn-active" : ""}`}
        >
          <Home size={18} />
          <span className="hidden lg:inline">Home</span>
        </Link>

        <Link
          to="/upload"
          className={`btn btn-sm btn-ghost gap-2 ${isActive("/upload") ? "btn-active" : ""}`}
        >
          <Upload size={18} />
          <span className="hidden lg:inline">Upload</span>
        </Link>

        <button onClick={toggleTheme} className="btn btn-sm btn-ghost gap-2" title="Toggle theme">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          <span className="hidden lg:inline">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>

        {authUser && (
          <button onClick={handleLogout} className="btn btn-sm btn-ghost text-error">
            <LogOut size={18} />
          </button>
        )}
      </div>

      {/* Mobile Menu Button */}
      <div className="flex-none md:hidden">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="btn btn-ghost btn-circle"
        >
          {isMenuOpen ? <X /> : <Menu />}
        </button>

        {/* Mobile Navigation Dropdown */}
        {isMenuOpen && (
          <div className="absolute top-16 right-0 left-0 z-50 bg-base-200 rounded-b-lg border-t border-base-300 shadow-xl">
            <div className="flex flex-col p-4 gap-2">
              <Link
                to="/"
                className={`btn btn-sm btn-ghost justify-start gap-2 ${isActive("/") ? "btn-active" : ""}`}
                onClick={() => setIsMenuOpen(false)}
              >
                <Home size={18} />
                Home
              </Link>

              <Link
                to="/upload"
                className={`btn btn-sm btn-ghost justify-start gap-2 ${isActive("/upload") ? "btn-active" : ""}`}
                onClick={() => setIsMenuOpen(false)}
              >
                <Upload size={18} />
                Upload PDF
              </Link>

              <button
                onClick={() => {
                  toggleTheme();
                  setIsMenuOpen(false);
                }}
                className="btn btn-sm btn-ghost justify-start gap-2"
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </button>

              {authUser && (
                <button
                  onClick={handleLogout}
                  className="btn btn-sm btn-ghost justify-start gap-2 text-error"
                >
                  <LogOut size={18} />
                  Logout
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;