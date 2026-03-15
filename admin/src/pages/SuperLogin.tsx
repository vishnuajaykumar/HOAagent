import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { superLogin } from '../api'

export default function SuperLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await superLogin(email, password)
      localStorage.setItem('super_token', data.access_token)
      navigate('/super/dashboard')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.logo}>HOAbot</h1>
        <h2 style={s.subtitle}>Super Admin Login</h2>
        <form onSubmit={handleSubmit}>
          {error && <div style={s.error}>{error}</div>}
          <input style={s.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={s.input} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button style={s.btn} type="submit" disabled={loading}>{loading ? 'Logging in...' : 'Login'}</button>
        </form>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1d1d1f', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  card: { background: 'rgba(255, 255, 255, 0.98)', padding: 48, borderRadius: 20, width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', backdropFilter: 'blur(20px)' },
  logo: { textAlign: 'center', color: '#1d1d1f', marginBottom: 4, fontWeight: 600, letterSpacing: -0.5 },
  subtitle: { textAlign: 'center', color: '#86868b', fontSize: 16, fontWeight: 500, marginBottom: 32 },
  error: { background: '#fffbeb', color: '#ff3b30', padding: 12, borderRadius: 12, marginBottom: 20, fontSize: 14, border: '1px solid #ff3b3020' },
  input: { width: '100%', padding: '12px 16px', marginBottom: 16, border: '1px solid #d2d2d7', borderRadius: 12, fontSize: 15, outline: 'none', background: '#ffffff', color: '#1d1d1f', boxSizing: 'border-box' },
  btn: { width: '100%', padding: 14, background: '#1d1d1f', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 500, cursor: 'pointer', transition: 'background 0.2s', marginTop: 8 },
}
