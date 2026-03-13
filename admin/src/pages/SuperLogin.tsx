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
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' },
  card: { background: 'white', padding: 40, borderRadius: 16, width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  logo: { textAlign: 'center', color: '#2563eb', marginBottom: 4 },
  subtitle: { textAlign: 'center', color: '#1e293b', fontSize: 18, fontWeight: 500, marginBottom: 24 },
  error: { background: '#fef2f2', color: '#ef4444', padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  input: { width: '100%', padding: '10px 14px', marginBottom: 12, border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none' },
  btn: { width: '100%', padding: 12, background: '#1e293b', color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
}
