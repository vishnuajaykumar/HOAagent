import React from 'react'
import { useNavigate } from 'react-router-dom'

interface LayoutProps {
  title: string
  role: 'super' | 'client'
  children: React.ReactNode
}

export default function Layout({ title, role, children }: LayoutProps) {
  const navigate = useNavigate()

  const logout = () => {
    localStorage.removeItem(role === 'super' ? 'super_token' : 'client_token')
    navigate(role === 'super' ? '/super/login' : '/admin/login')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <nav style={s.nav}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={s.logo}>HOAbot</span>
          <span style={s.role}>{role === 'super' ? 'Super Admin' : 'Client Admin'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: '#94a3b8', fontSize: 14 }}>{title}</span>
          <button style={s.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </nav>
      <main style={{ padding: 32 }}>{children}</main>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  nav: { background: '#1e293b', padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { color: 'white', fontWeight: 700, fontSize: 18 },
  role: { background: '#2563eb', color: 'white', fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600 },
  logoutBtn: { background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
}
