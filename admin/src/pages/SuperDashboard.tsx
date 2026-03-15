import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { 
  getClients, suspendClient, activateClient, archiveClient, setLimits, 
  approveCommunity, suspendCommunity, archiveCommunity, setCommunityAI, 
  getAIModels, deleteCommunitySuper, getAllUsage 
} from '../api'

const APPLE_ACCENT = '#000000'
const APPLE_BG = '#f5f5f7'
const APPLE_CARD = '#ffffff'
const APPLE_TEXT = '#1d1d1f'
const APPLE_MUTED = '#86868b'
const APPLE_BORDER = '#d2d2d7'
const GREEN = '#34c759'
const RED = '#ff3b30'
const ORANGE = '#ff9500'

interface Community {
  id: string; name: string; manager_name: string; manager_email: string; location: string;
  status: string; model_tier: string; ai_provider: string; ai_model: string;
  api_key: string; is_archived: boolean; created_at: string; approved_at: string | null;
}

interface Client {
  id: string; company_name: string; email: string; status: string; is_archived: boolean;
  token_limit_monthly: number; tokens_used_this_month: number;
  created_at: string; communities: Community[];
}

export default function SuperDashboard() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [usage, setUsage] = useState<any[]>([])
  const [aiModels, setAiModels] = useState<Record<string, string[]>>({})
  const [tab, setTab] = useState<'clients' | 'usage'>('clients')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingLimit, setEditingLimit] = useState<{ id: string; value: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('super_token')) navigate('/super/login')
    else load()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [c, u, am] = await Promise.all([getClients(), getAllUsage(), getAIModels()])
      setClients(c)
      setUsage(u)
      setAiModels(am || {})
      
      const toExpand = new Set<string>()
      c.forEach((client: Client) => {
        if (client.communities.some((comm: Community) => comm.status === 'pending')) {
          toExpand.add(client.id)
        }
      })
      setExpanded(toExpand)
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('403')) navigate('/super/login')
      setError(err.message)
    } finally { setLoading(false) }
  }

  const act = async (fn: () => Promise<any>) => {
    try { await fn(); await load() } 
    catch (err: any) { alert(err.message) }
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const statusBadge = (s: string, label?: string) => {
    const color = s === 'active' ? GREEN : s === 'pending' ? ORANGE : s === 'suspended' ? RED : APPLE_MUTED
    return <span style={{ padding: '2px 8px', borderRadius: 12, color: color, fontSize: 12, fontWeight: 500, background: `${color}15` }}>{label || s.charAt(0).toUpperCase() + s.slice(1)}</span>
  }

  const pendingCount = clients.reduce((acc, c) => acc + c.communities.filter(comm => comm.status === 'pending').length, 0)

  return (
    <Layout title="Super Admin" role="super">
      {/* Summary Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Companies', value: clients.length },
          { label: 'Total HOAs', value: clients.reduce((a, c) => a + c.communities.length, 0) },
          { label: 'Pending Approvals', value: pendingCount, color: pendingCount > 0 ? ORANGE : APPLE_TEXT },
          { label: 'Active HOAs', value: clients.reduce((a, c) => a + c.communities.filter(comm => comm.status === 'active').length, 0) },
        ].map(s => (
          <div key={s.label} style={{ background: APPLE_CARD, padding: '20px 24px', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
            <div style={{ fontSize: 12, color: APPLE_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontWeight: 500 }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 600, color: s.color || APPLE_TEXT, letterSpacing: -0.5 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['clients', 'usage'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500,
                background: tab === t ? APPLE_TEXT : 'transparent', color: tab === t ? 'white' : APPLE_MUTED, transition: 'all 0.2s',
                ...(tab !== t && { border: `1px solid ${APPLE_BORDER}` })
               }}>
              {t === 'clients' ? `Companies (${clients.filter(c => showArchived || !c.is_archived).length})` : 'Usage Overview'}
            </button>
          ))}
        </div>
        {tab === 'clients' && (
          <label style={{ fontSize: 13, color: APPLE_MUTED, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show Archived
          </label>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', color: APPLE_MUTED, padding: 40, fontWeight: 500 }}>Loading...</div>}
      {error && <div style={{ background: '#fff1f0', color: RED, padding: 16, borderRadius: 12, marginBottom: 20 }}>{error}</div>}

      {/* ─── CLIENTS TAB ─── */}
      {tab === 'clients' && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {clients.filter(c => showArchived || !c.is_archived).length === 0 && (
            <div style={{ textAlign: 'center', color: APPLE_MUTED, padding: 80, background: APPLE_CARD, borderRadius: 16, fontSize: 15 }}>
              No management companies found.
            </div>
          )}
          {clients.filter(c => showArchived || !c.is_archived).map(c => (
            <div key={c.id} style={{ background: APPLE_CARD, borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', opacity: c.is_archived ? 0.6 : 1 }}>
              {/* Management Company Header */}
              <div 
                style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', borderBottom: expanded.has(c.id) ? `1px solid ${APPLE_BORDER}` : 'none' }}
                onClick={() => toggleExpand(c.id)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontWeight: 600, color: APPLE_TEXT, fontSize: 18, letterSpacing: -0.3 }}>{c.company_name}</span>
                    {statusBadge(c.status)}
                    {c.communities.some(comm => comm.status === 'pending') && statusBadge('pending', `${c.communities.filter(comm => comm.status === 'pending').length} Pending`)}
                  </div>
                  <div style={{ fontSize: 14, color: APPLE_MUTED, marginTop: 4 }}>
                    {c.email} · {c.communities.length} {c.communities.length === 1 ? 'HOA' : 'HOAs'} · Joined {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ fontSize: 14, color: APPLE_MUTED, textAlign: 'right' }}>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>
                    <span style={{ color: APPLE_TEXT }}>{(c.tokens_used_this_month / 1000).toFixed(1)}k</span> / {(c.token_limit_monthly / 1000).toFixed(0)}k tkns
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {c.status === 'active' ?
                      <button style={{ ...actBtn, color: ORANGE }} onClick={(e) => { e.stopPropagation(); act(() => suspendClient(c.id)) }}>Suspend</button> :
                      <button style={{ ...actBtn, color: GREEN }} onClick={(e) => { e.stopPropagation(); act(() => activateClient(c.id)) }}>Activate</button>
                    }
                    {c.status === 'suspended' && !c.is_archived && (
                      <button style={{ ...actBtn, color: APPLE_MUTED }} onClick={(e) => { e.stopPropagation(); if (confirm(`Archive ${c.company_name}?`)) act(() => archiveClient(c.id)) }}>Archive</button>
                    )}
                    {editingLimit?.id === c.id ? (
                      <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input style={{ width: 80, padding: '6px 8px', border: `1px solid ${APPLE_ACCENT}`, borderRadius: 6, fontSize: 13, outline: 'none' }}
                          value={editingLimit.value} type="number" onChange={e => setEditingLimit({ id: c.id, value: e.target.value })} />
                        <button style={actBtn} onClick={() => { act(() => setLimits(c.id, parseInt(editingLimit.value))); setEditingLimit(null) }}>Save</button>
                        <button style={actBtn} onClick={() => setEditingLimit(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button style={actBtn} onClick={(e) => { e.stopPropagation(); setEditingLimit({ id: c.id, value: c.token_limit_monthly.toString() }) }}>Limit</button>
                    )}
                  </div>
                </div>
                <span style={{ color: APPLE_MUTED, transition: 'transform 0.2s', transform: expanded.has(c.id) ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </span>
              </div>

              {/* HOA Communities (Expanded) */}
              {expanded.has(c.id) && (
                <div style={{ padding: '16px 24px 24px', background: '#fafafa' }}>
                  {c.communities.filter(comm => showArchived || !comm.is_archived).length === 0 ? (
                    <div style={{ color: APPLE_MUTED, fontSize: 14, padding: '16px 0', textAlign: 'center' }}>No active HOAs.</div>
                  ) : (
                    c.communities.filter(comm => showArchived || !comm.is_archived).map(comm => (
                      <div key={comm.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: APPLE_CARD, borderRadius: 12, marginTop: 12, border: `1px solid ${APPLE_BORDER}`, opacity: comm.is_archived ? 0.6 : 1 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 500, color: APPLE_TEXT, fontSize: 15 }}>{comm.name}</span>
                            {statusBadge(comm.status)}
                          </div>
                          <div style={{ fontSize: 13, color: APPLE_MUTED, marginTop: 6, display: 'flex', gap: 12 }}>
                            {comm.manager_name && <span>{comm.manager_name}</span>}
                            {comm.manager_email && <span>{comm.manager_email}</span>}
                            {comm.location && <span>{comm.location}</span>}
                          </div>
                          {comm.approved_at && <div style={{ fontSize: 12, color: APPLE_MUTED, marginTop: 4 }}>Approved: {new Date(comm.approved_at).toLocaleDateString()}</div>}
                        </div>

                        {/* AI Provider & Model Control */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <select 
                            value={comm.ai_provider || 'anthropic'}
                            onChange={e => {
                              const newProvider = e.target.value;
                              const currentModels = aiModels[newProvider] || [];
                              const firstModel = currentModels[0] || 'haiku';
                              act(() => setCommunityAI(comm.id, newProvider, firstModel));
                            }}
                            style={selectStyle}
                          >
                            {Object.keys(aiModels).map(p => (
                              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                            ))}
                          </select>

                          <select 
                            value={comm.ai_model || 'haiku'}
                            onChange={e => act(() => setCommunityAI(comm.id, comm.ai_provider || 'anthropic', e.target.value))}
                            style={selectStyle}
                          >
                            {(aiModels[comm.ai_provider || 'anthropic'] || []).map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: 8, marginLeft: 8 }}>
                          {comm.status === 'pending' && <button style={{ ...actBtn, color: GREEN }} onClick={() => act(() => approveCommunity(comm.id))}>Approve</button>}
                          {comm.status === 'active' && <button style={{ ...actBtn, color: ORANGE }} onClick={() => act(() => suspendCommunity(comm.id))}>Suspend</button>}
                          {comm.status === 'suspended' && <button style={{ ...actBtn, color: GREEN }} onClick={() => act(() => approveCommunity(comm.id))}>Re-Activate</button>}
                          {comm.status === 'suspended' && !comm.is_archived && <button style={{ ...actBtn, color: APPLE_MUTED }} onClick={() => { if (confirm(`Archive HOA "${comm.name}"?`)) act(() => archiveCommunity(comm.id)) }}>Archive</button>}
                          <button style={{ ...actBtn, color: RED }} onClick={() => { if (confirm(`Delete HOA "${comm.name}"?`)) act(() => deleteCommunitySuper(comm.id)) }}>Delete</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── USAGE TAB ─── */}
      {tab === 'usage' && !loading && (
        <div style={{ background: APPLE_CARD, borderRadius: 16, overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Company', 'Status', 'Tokens Used', 'Limit', 'Usage %'].map(h => (
                  <th key={h} style={{ padding: '16px 24px', textAlign: 'left', fontSize: 12, color: APPLE_MUTED, textTransform: 'uppercase', fontWeigth: 500, letterSpacing: 0.5, borderBottom: `1px solid ${APPLE_BORDER}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.map(u => (
                <tr key={u.client_id}>
                  <td style={tdStyle}>{u.company_name}</td>
                  <td style={tdStyle}>{statusBadge(u.status)}</td>
                  <td style={tdStyle}>{u.tokens_used_this_month?.toLocaleString()}</td>
                  <td style={tdStyle}>{u.token_limit_monthly?.toLocaleString()}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(u.usage_percent, 100)}%`, height: '100%', background: u.usage_percent > 90 ? RED : APPLE_ACCENT, borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500, width: 40, textAlign: 'right' }}>{u.usage_percent}%</span>
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

const tdStyle: React.CSSProperties = { padding: '16px 24px', fontSize: 14, color: APPLE_TEXT, borderBottom: `1px solid ${APPLE_BORDER}` }
const actBtn: React.CSSProperties = { padding: '6px 12px', border: `1px solid ${APPLE_BORDER}`, borderRadius: 8, cursor: 'pointer', fontSize: 13, background: 'transparent', fontWeight: 500, transition: 'all 0.2s', color: APPLE_TEXT }
const selectStyle: React.CSSProperties = { padding: '8px 12px', border: `1px solid ${APPLE_BORDER}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'white', color: APPLE_TEXT, fontWeight: 500, outline: 'none' }
