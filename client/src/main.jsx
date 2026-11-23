import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Upload from './pages/Upload.jsx';
import Wall from './pages/Wall.jsx';
import Admin from './pages/Admin.jsx';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/upload" element={<Upload />} />
      <Route path="/wall" element={<Wall />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/upload" replace />} />
    </Routes>
  </BrowserRouter>
);
