import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import SuperLogin from './pages/SuperLogin'
import SuperDashboard from './pages/SuperDashboard'
import ClientLogin from './pages/ClientLogin'
import ClientSignup from './pages/ClientSignup'
import ClientDashboard from './pages/ClientDashboard'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" />} />
        <Route path="/admin/login" element={<ClientLogin />} />
        <Route path="/admin/signup" element={<ClientSignup />} />
        <Route path="/admin/dashboard" element={<ClientDashboard />} />
        <Route path="/super/login" element={<SuperLogin />} />
        <Route path="/super/dashboard" element={<SuperDashboard />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
