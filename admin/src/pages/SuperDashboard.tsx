import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { getClients, approveClient, suspendClient, cancelClient, setLimits, setTier, getAllUsage } from '../api'

interface Client {
  id: string
  company_name: string
  email: string
  status: string
  api_key: string
  token_limit_monthly: number
  tokens_used_this_month: number
  model_tier: string
  created_at: string
}

export default function SuperDashboard() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [usage, setUsage] = useState<any[]>([])
  const [tab, setTab] = useState<'clients' | 'usage'>('clients')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingLimit, setEditingLimit] = useState<{ id: string; value: string } | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('super_token')) navigate('/super/login')
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [c, u] = await Promise.all([getClients(), getAllUsage()])
      setClients(c)
      setUsage(u)
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('403')) navigate('/super/login')
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const act = async (fn: () => Promise<any>) => {
    try { await fn(); await load() } catch (err: any) { alert(err.message) }
  }

  const statusColor: Record<string, string> = {
    pending: '#f59e0b', active: '#22c55e', suspended: '#ef4444', cancelled: '#94a3b8'
  }

  const tierColor: Record<string, string> = {
    haiku: '#64748b', sonnet: '#7c3aed'
  }

  return (
    <Layout title="Super Admin Dashboard" role="super">
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {(['clients', 'usage'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 20px', border: '1.5px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              background: tab === t ? '#2563eb' : 'white', color: tab === t ? 'white' : '#64748b', borderColor: tab === t ? '#2563eb' : '#e2e8f0' }}>
            {t === 'clients' ? `Clients (${clients.length})` : 'Usage Overview'}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Loading...</div>}
      {error && <div style={{ background: '#fef2f2', color: '#ef4444', padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {tab === 'clients' && !loading && (
        <div style={{ background: 'white', borderRadius: 12, overflow: 'auto', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Company', 'Email', 'Status', 'Model Tier', 'Usage', 'Token Limit', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}>
                  <td style={td}>{c.company_name}</td>
                  <td style={td}>{c.email}</td>
                  <td style={td}>
                    <span style={{ padding: '2px 10px', borderRadius: 999, color: 'white', fontSize: 12, fontWeight: 600, background: statusColor[c.status] || '#94a3b8' }}>{c.status}</span>
                  </td>
                  <td style={td}>
                    <select
                      value={c.model_tier || 'haiku'}
                      onChange={e => act(() => setTier(c.id, e.target.value))}
                      style={{ padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        color: 'white', background: tierColor[c.model_tier || 'haiku'], fontWeight: 600 }}
                    >
                      <option value="haiku" style={{ background: '#64748b' }}>Haiku (Basic)</option>
                      <option value="sonnet" style={{ background: '#7c3aed' }}>Sonnet (Standard)</option>
                    </select>
                  </td>
                  <td style={td}>{(c.tokens_used_this_month / 1000).toFixed(1)}K / {(c.token_limit_monthly / 1000).toFixed(0)}K</td>
                  <td style={td}>
                    {editingLimit?.id === c.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input style={{ width: 100, padding: '4px 8px', border: '1.5px solid #2563eb', borderRadius: 4, fontSize: 13 }}
                          value={editingLimit.value} type="number"
                          onChange={e => setEditingLimit({ id: c.id, value: e.target.value })} />
                        <button style={smBtn} onClick={() => { act(() => setLimits(c.id, parseInt(editingLimit.value))); setEditingLimit(null) }}>✓</button>
                        <button style={smBtn} onClick={() => setEditingLimit(null)}>✕</button>
                      </div>
                    ) : (
                      <span style={{ cursor: 'pointer', color: '#2563eb' }} onClick={() => setEditingLimit({ id: c.id, value: c.token_limit_monthly.toString() })}>
                        {c.token_limit_monthly.toLocaleString()} ✎
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {c.status === 'pending' && <button style={{ ...actBtn, background: '#22c55e' }} onClick={() => act(() => approveClient(c.id))}>Approve</button>}
                      {c.status === 'active' && <button style={{ ...actBtn, background: '#f59e0b' }} onClick={() => act(() => suspendClient(c.id))}>Suspend</button>}
                      {['active', 'suspended'].includes(c.status) && (
                        <button style={{ ...actBtn, background: '#ef4444' }} onClick={() => { if (confirm(`Cancel ${c.company_name}?`)) act(() => cancelClient(c.id)) }}>Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'usage' && !loading && (
        <div style={{ background: 'white', borderRadius: 12, overflow: 'auto', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Company', 'Status', 'Model', 'Tokens Used', 'Limit', 'Usage %'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {usage.map(u => (
                <tr key={u.client_id}>
                  <td style={td}>{u.company_name}</td>
                  <td style={td}><span style={{ padding: '2px 10px', borderRadius: 999, color: 'white', fontSize: 12, fontWeight: 600, background: statusColor[u.status] }}>{u.status}</span></td>
                  <td style={td}><span style={{ padding: '2px 8px', borderRadius: 999, color: 'white', fontSize: 11, fontWeight: 600, background: tierColor[u.model_tier || 'haiku'] }}>{u.model_tier || 'haiku'}</span></td>
                  <td style={td}>{u.tokens_used_this_month?.toLocaleString()}</td>
                  <td style={td}>{u.token_limit_monthly?.toLocaleString()}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(u.usage_percent, 100)}%`, height: '100%', background: u.usage_percent > 90 ? '#ef4444' : '#2563eb', borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 13 }}>{u.usage_percent}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}

const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14, color: '#1e293b', borderBottom: '1px solid #f1f5f9' }
const smBtn: React.CSSProperties = { padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: 12, background: 'white' }
const actBtn: React.CSSProperties = { padding: '4px 10px', border: 'none', borderRadius: 6, color: 'white', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
