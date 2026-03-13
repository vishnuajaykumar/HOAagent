import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { clientSignup } from '../api'

export default function ClientSignup() {
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await clientSignup(company, email, password)
      setSuccess(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={{ textAlign: 'center', fontSize: 48, color: '#22c55e', marginBottom: 16 }}>✓</div>
          <h2 style={s.subtitle}>Account Created!</h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: 14, marginBottom: 24 }}>
            Your account is pending approval. You'll be able to log in once approved by the administrator.
          </p>
          <Link to="/admin/login" style={{ display: 'block', textAlign: 'center', color: '#2563eb', fontSize: 14 }}>Back to Login</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.logo}>HOAbot</h1>
        <h2 style={s.subtitle}>Create Account</h2>
        <form onSubmit={handleSubmit}>
          {error && <div style={s.error}>{error}</div>}
          <input style={s.input} type="text" placeholder="Company Name" value={company} onChange={e => setCompany(e.target.value)} required />
          <input style={s.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={s.input} type="password" placeholder="Password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          <button style={s.btn} type="submit" disabled={loading}>{loading ? 'Creating account...' : 'Sign Up'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14, color: '#64748b' }}>
          Already have an account? <Link to="/admin/login">Login</Link>
        </p>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' },
  card: { background: 'white', padding: 40, borderRadius: 16, width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  logo: { textAlign: 'center', color: '#2563eb', marginBottom: 4 },
  subtitle: { textAlign: 'center', color: '#1e293b', fontSize: 18, fontWeight: 500, marginBottom: 24 },
  error: { background: '#fef2f2', color: '#ef4444', padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  input: { width: '100%', padding: '10px 14px', marginBottom: 12, border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none' },
  btn: { width: '100%', padding: 12, background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
}
