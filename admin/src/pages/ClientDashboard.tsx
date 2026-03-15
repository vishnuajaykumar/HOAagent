import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import {
  getMe, getCommunities, createCommunity, deleteCommunity,
  getCommunityDocuments, uploadDocument, deleteDocument, getEmbedCode
} from '../api'

const APPLE_ACCENT = '#000000'
const APPLE_BG = '#f5f5f7'
const APPLE_CARD = 'rgba(255, 255, 255, 0.8)'
const APPLE_TEXT = '#1d1d1f'
const APPLE_MUTED = '#86868b'
const APPLE_BORDER = '#d2d2d7'
const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Community = {
  id: string; name: string; manager_name: string; manager_email: string; manager_phone: string;
  location: string; api_key: string; status: string; model_tier: string;
  created_at: string; approved_at: string | null;
}

type Document = { id: string; filename: string; status: string; uploaded_at: string }

type ChatMsg = { id: string; role: 'user' | 'assistant'; content: string }

// ─── Draggable Hook ───────────────────────────────────────────────────────────
function useDraggable(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let isDragging = false
    let startX = 0, startY = 0, initialX = 0, initialY = 0

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.no-drag')) return // prevent drag on buttons
      isDragging = true
      startX = e.clientX
      startY = e.clientY
      const rect = el.getBoundingClientRect()
      initialX = rect.left
      initialY = rect.top
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      el.style.left = `${initialX + dx}px`
      el.style.top = `${initialY + dy}px`
      el.style.bottom = 'auto'
      el.style.right = 'auto'
    }

    const handleMouseUp = () => {
      isDragging = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    // Attach to the header specifically if possible, else the whole element
    const handle = el.querySelector('.drag-handle') as HTMLElement || el
    handle.addEventListener('mousedown', handleMouseDown)

    return () => {
      handle.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [ref])
}

function useResizable(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handle = el.querySelector('.resize-handle') as HTMLElement
    if (!handle) return

    let isResizing = false
    let startX = 0, startY = 0, initW = 0, initH = 0, initTop = 0, initLeft = 0

    const onDown = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      isResizing = true
      startX = e.clientX
      startY = e.clientY
      const rect = el.getBoundingClientRect()
      initW = rect.width
      initH = rect.height
      initTop = rect.top
      initLeft = rect.left
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    const onMove = (e: MouseEvent) => {
      if (!isResizing) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      let newW = initW - dx
      let newH = initH - dy
      if (newW < 280) { newW = 280 }
      if (newH < 400) { newH = 400 }
      el.style.width = `${newW}px`
      el.style.height = `${newH}px`
      el.style.left = `${initLeft + (initW - newW)}px`
      el.style.top = `${initTop + (initH - newH)}px`
      el.style.bottom = 'auto'
      el.style.right = 'auto'
    }

    const onUp = () => {
      isResizing = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    handle.addEventListener('mousedown', onDown)
    return () => {
      handle.removeEventListener('mousedown', onDown)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [ref])
}

// ─── TestChatBubble ───────────────────────────────────────────────────────────
function TestChatBubble({ community, docs, visible }: { community: Community; docs: Document[]; visible: boolean }) {
  const hasReadyDocs = docs.some(d => d.status === 'ready')
  const hasProcessingDocs = docs.some(d => d.status === 'processing')

  const makeWelcome = useCallback((): ChatMsg => ({
    id: '0',
    role: 'assistant',
    content: hasReadyDocs
      ? `Hi! I'm the assistant for **${community.name}**. Ask me anything about the community's rules.`
      : docs.length === 0
        ? `Hi! No documents have been uploaded for **${community.name}** yet. Please upload them in the Documents tab first.`
        : `The documents for **${community.name}** are still processing. Check back soon.`,
  }), [community.id, hasReadyDocs, docs.length])

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([makeWelcome()])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatWindowRef = useRef<HTMLDivElement>(null)

  useDraggable(chatWindowRef)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const el = chatWindowRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const initW = rect.width
    const initH = rect.height
    const initLeft = rect.left
    const initTop = rect.top

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const newW = Math.max(280, initW - dx)
      const newH = Math.max(400, initH - dy)
      el.style.width = `${newW}px`
      el.style.height = `${newH}px`
      el.style.left = `${initLeft + (initW - newW)}px`
      el.style.top = `${initTop + (initH - newH)}px`
      el.style.bottom = 'auto'
      el.style.right = 'auto'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    setIsOpen(false)
    setMessages([makeWelcome()])
    setInput('')
    setIsLoading(false)
  }, [community.id, makeWelcome])

  useEffect(() => {
    setMessages(prev => (prev.length === 1 && prev[0].id === '0' ? [makeWelcome()] : prev))
  }, [hasReadyDocs, hasProcessingDocs, makeWelcome])

  useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

  const sendMessage = async (overrideText?: string) => {
    const question = (overrideText ?? input).trim()
    if (!question || isLoading) return

    const ts = Date.now().toString()
    const userId = `user-${ts}`
    const assistantId = `assistant-${ts}`

    setMessages(prev => [...prev, { id: userId, role: 'user', content: question }])
    setInput('')
    setIsLoading(true)

    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const token = localStorage.getItem('client_token') || ''
      const res = await fetch(`${API_BASE}/client/communities/${community.id}/test-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question }),
      })

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`)

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream')) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.text) {
                  setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + data.text } : m))
                }
              } catch { }
            }
          }
        }
      } else {
        const data = await res.json()
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: data.answer || 'No response' } : m))
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${err.message}` } : m))
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  if (!visible) return null

  if (!isOpen) {
    return (
      <div
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, width: 60, height: 60, borderRadius: 30,
          background: APPLE_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', 
          cursor: 'pointer', zIndex: 99999, transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)'
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
      </div>
    )
  }

  return (
    <div ref={chatWindowRef} style={{
      position: 'fixed', bottom: 24, right: 24, width: 380, height: 580, minWidth: 280, minHeight: 400,
      borderRadius: 16, background: 'rgba(255, 255, 255, 0.95)', display: 'flex', flexDirection: 'column',
      zIndex: 99999, border: `1px solid ${APPLE_BORDER}`, backdropFilter: 'blur(20px)',
      boxShadow: '0 10px 40px rgba(0,0,0,0.1)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden'
    }}>
      {/* Top-left resize handle */}
      <div className="resize-handle no-drag" onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', top: 0, left: 0, width: 28, height: 28, cursor: 'nwse-resize', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ opacity: 0.4, transform: 'rotate(90deg)' }}>
          <line x1="0" y1="12" x2="12" y2="0" stroke="#888" strokeWidth="1.5" />
          <line x1="0" y1="8" x2="8" y2="0" stroke="#888" strokeWidth="1.5" />
          <line x1="0" y1="4" x2="4" y2="0" stroke="#888" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="drag-handle" style={{ background: 'transparent', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${APPLE_BORDER}`, cursor: 'grab' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: APPLE_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 500, fontSize: 14 }}>J</div>
          <div>
            <div style={{ color: APPLE_TEXT, fontWeight: 600, fontSize: 14 }}>Jenny</div>
            <div style={{ color: APPLE_MUTED, fontSize: 11 }}>Online</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="no-drag">
          <button onClick={() => { setMessages([makeWelcome()]); setInput(''); const el = chatWindowRef.current; if (el) { el.style.width = '380px'; el.style.height = '580px'; el.style.top = ''; el.style.left = ''; el.style.bottom = '24px'; el.style.right = '24px'; } }} style={{ background: 'none', border: `1px solid ${APPLE_BORDER}`, color: APPLE_TEXT, cursor: 'pointer', fontSize: 12, padding: '4px 8px', borderRadius: 12, fontWeight: 500 }}>Reset</button>
          <button onClick={() => { const el = chatWindowRef.current; if (el) { el.style.width = '380px'; el.style.height = '580px'; el.style.top = ''; el.style.left = ''; el.style.bottom = '24px'; el.style.right = '24px'; } setIsOpen(false) }} style={{ background: 'none', border: 'none', color: APPLE_MUTED, cursor: 'pointer', fontSize: 18, padding: 4, display: 'flex', alignItems: 'center' }}>✕</button>
        </div>
      </div>
      <div style={{ background: APPLE_BG, borderBottom: `1px solid ${APPLE_BORDER}`, padding: '4px 12px', fontSize: 12, color: APPLE_MUTED, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
        TEST MODE - {community.name} {community.status === 'pending' && <span style={{ color: '#d97706' }}>(Pending)</span>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: APPLE_BG }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              background: msg.role === 'user' ? APPLE_ACCENT : '#ffffff',
              color: msg.role === 'user' ? 'white' : APPLE_TEXT,
              padding: '10px 14px', borderRadius: 16, maxWidth: '82%', fontSize: 14, lineHeight: 1.5,
              wordBreak: 'break-word', border: msg.role === 'assistant' ? `1px solid ${APPLE_BORDER}` : 'none',
              whiteSpace: 'pre-wrap', borderBottomRightRadius: msg.role === 'user' ? 4 : 16, borderBottomLeftRadius: msg.role === 'assistant' ? 4 : 16,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}>
              {msg.content || (isLoading && msg.role === 'assistant' ? <span style={{ opacity: 0.5 }}>...</span> : null)}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ padding: '12px 14px', background: 'transparent', borderTop: `1px solid ${APPLE_BORDER}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} placeholder={hasReadyDocs ? 'Ask something...' : 'Upload documents first...'} disabled={isLoading} style={{ flex: 1, padding: '12px 16px', borderRadius: 20, border: `1px solid ${APPLE_BORDER}`, fontSize: 16, outline: 'none', background: '#ffffff', color: APPLE_TEXT }} />
        <button onClick={() => sendMessage()} disabled={isLoading || !input.trim()} style={{ width: 40, height: 40, borderRadius: 20, background: APPLE_ACCENT, color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isLoading || !input.trim() ? 0.5 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
        </button>
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ClientDashboard() {
  const navigate = useNavigate()
  const [me, setMe] = useState<any>(null)
  const [communities, setCommunities] = useState<Community[]>([])
  const [selected, setSelected] = useState<Community | null>(null)
  const [tab, setTab] = useState<'info' | 'documents' | 'embed' | 'chat'>('info')
  const [docs, setDocs] = useState<Document[]>([])
  const [embedInfo, setEmbedInfo] = useState<any>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', manager_name: '', manager_email: '', manager_phone: '', location: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!localStorage.getItem('client_token')) navigate('/admin/login')
    else loadAll()
  }, [])

  const loadAll = async () => {
    try {
      const [m, c] = await Promise.all([getMe(), getCommunities()])
      setMe(m); setCommunities(c)
      if (!selected && c.length > 0) setSelected(c[0])
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('403')) navigate('/admin/login')
    }
  }

  useEffect(() => { if (selected) loadCommunityData() }, [selected])

  const loadCommunityData = async () => {
    if (!selected) return
    try {
      const [d, e] = await Promise.all([getCommunityDocuments(selected.id), getEmbedCode(selected.id)])
      setDocs(d); setEmbedInfo(e)
    } catch {}
  }

  useEffect(() => {
    const hasProcessing = docs.some(d => d.status === 'processing')
    if (!hasProcessing || !selected) return
    const interval = setInterval(() => loadCommunityData(), 5000)
    return () => clearInterval(interval)
  }, [docs, selected])

  useEffect(() => {
    const hasProcessing = docs.some(d => d.status === 'processing')
    if (!hasProcessing || !selected) return
    const interval = setInterval(() => loadCommunityData(), 5000)
    return () => clearInterval(interval)
  }, [docs, selected])

  const handleCreate = async () => {
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const newComm = await createCommunity(form)
      setCommunities(prev => [newComm, ...prev])
      setSelected(newComm)
      setShowCreate(false)
      setForm({ name: '', manager_name: '', manager_email: '', manager_phone: '', location: '' })
    } catch (err: any) { alert(err.message) }
    finally { setCreating(false) }
  }

  const handleDelete = async (comm: Community) => {
    if (!confirm(`Delete "${comm.name}"? This cannot be undone.`)) return
    await deleteCommunity(comm.id)
    const updated = communities.filter(c => c.id !== comm.id)
    setCommunities(updated)
    setSelected(updated[0] || null)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selected) return
    setUploading(true); setUploadMsg('')
    try {
      await uploadDocument(file, selected.id)
      setUploadMsg('Uploaded successfully! Processing.')
      loadCommunityData()
    } catch (err: any) { setUploadMsg(`Error: ${err.message}`) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const handleDeleteDoc = async (docId: string) => {
    if (!selected || !confirm('Delete this document?')) return
    await deleteDocument(selected.id, docId)
    loadCommunityData()
  }

  const statusColor = (s: string) => s === 'active' ? '#34c759' : s === 'pending' ? '#ff9500' : '#ff3b30'
  const statusLabel = (s: string) => s === 'active' ? 'Active' : s === 'pending' ? 'Pending' : s.charAt(0).toUpperCase() + s.slice(1)

  if (!me) return <div style={{ padding: 40, textAlign: 'center', color: APPLE_TEXT, fontWeight: 500 }}>Loading...</div>

  return (
    <Layout title={me.company_name} role="client">
      <div style={{ display: 'flex', gap: 24, minHeight: 600, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        {/* Sidebar */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontWeight: 600, color: APPLE_TEXT, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              My HOAs ({communities.length}/20)
            </span>
            <button onClick={() => setShowCreate(true)} style={{ background: APPLE_ACCENT, color: 'white', border: 'none', borderRadius: 14, padding: '4px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Add HOA</button>
          </div>
          {communities.length === 0 && <div style={{ color: APPLE_MUTED, fontSize: 13, padding: 16, background: APPLE_CARD, borderRadius: 12, textAlign: 'center' }}>No HOAs yet.</div>}
          {communities.map(c => (
            <div key={c.id} onClick={() => { setSelected(c); setTab('info') }} style={{ padding: '14px 16px', background: selected?.id === c.id ? APPLE_ACCENT : APPLE_CARD, color: selected?.id === c.id ? 'white' : APPLE_TEXT, borderRadius: 12, marginBottom: 8, cursor: 'pointer', transition: 'all 0.2s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{c.name}</div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(c) }} style={{ background: 'none', border: 'none', color: selected?.id === c.id ? 'rgba(255,255,255,0.7)' : '#ff3b30', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, marginTop: 4, fontWeight: 500, color: selected?.id === c.id ? 'rgba(255,255,255,0.9)' : statusColor(c.status) }}>{statusLabel(c.status)}</div>
              {c.location && <div style={{ fontSize: 12, marginTop: 2, color: selected?.id === c.id ? 'rgba(255,255,255,0.7)' : APPLE_MUTED }}>{c.location}</div>}
            </div>
          ))}
        </div>

        {/* Main */}
        <div style={{ flex: 1 }}>
          {!selected ? (
            <div style={{ background: APPLE_CARD, borderRadius: 16, padding: 60, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: APPLE_MUTED }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 16 }}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              <h3 style={{ color: APPLE_TEXT, marginBottom: 8, fontWeight: 500 }}>No HOA Selected</h3>
              <p style={{ fontSize: 14 }}>Select an HOA from the sidebar, or create a new one to get started.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ background: APPLE_CARD, borderRadius: 16, padding: '24px 32px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, color: APPLE_TEXT, fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>{selected.name}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    <span style={{ fontSize: 13, color: statusColor(selected.status), fontWeight: 500 }}>{statusLabel(selected.status)}</span>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                {(['info', 'documents', 'embed', 'chat'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500, background: tab === t ? APPLE_ACCENT : 'transparent', color: tab === t ? 'white' : APPLE_MUTED, transition: 'all 0.2s' }}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div style={{ background: APPLE_CARD, borderRadius: 16, padding: 32, minHeight: 400 }}>
                {tab === 'info' && (
                  <div>
                    <h3 style={{ color: APPLE_TEXT, marginBottom: 24, fontWeight: 500, fontSize: 18 }}>Details</h3>
                    {[{ label: 'Manager Name', value: selected.manager_name }, { label: 'Manager Email', value: selected.manager_email }, { label: 'Manager Phone', value: selected.manager_phone }, { label: 'Location', value: selected.location || '—' }, { label: 'Created', value: new Date(selected.created_at).toLocaleDateString() }].map(row => (
                      <div key={row.label} style={{ display: 'flex', padding: '12px 0', borderBottom: `1px solid ${APPLE_BORDER}` }}>
                        <div style={{ width: 180, color: APPLE_MUTED, fontSize: 14 }}>{row.label}</div>
                        <div style={{ color: APPLE_TEXT, fontSize: 14, fontWeight: 500 }}>{row.value}</div>
                      </div>
                    ))}
                    {selected.status === 'pending' && <div style={{ marginTop: 24, padding: 16, background: '#fffbeb', borderRadius: 12, color: '#d97706', fontSize: 14 }}>This HOA is pending approval. You can still test the chat functionality.</div>}
                  </div>
                )}
                {tab === 'documents' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                      <h3 style={{ color: APPLE_TEXT, margin: 0, fontWeight: 500, fontSize: 18 }}>Documents</h3>
                      <label style={{ padding: '8px 16px', background: selected.status === 'active' ? APPLE_ACCENT : '#e5e5ea', color: selected.status === 'active' ? 'white' : APPLE_MUTED, borderRadius: 8, cursor: selected.status === 'active' ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 500 }}>
                        {uploading ? 'Processing...' : 'Upload PDF'}
                        <input ref={fileRef} type="file" accept=".pdf" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading || selected.status !== 'active'} />
                      </label>
                    </div>
                    {selected.status !== 'active' && <div style={{ padding: 16, background: '#fffbeb', borderRadius: 12, color: '#d97706', marginBottom: 20 }}>HOA must be active to upload new documents.</div>}
                    {uploadMsg && <div style={{ marginBottom: 16, fontSize: 14, color: uploadMsg.includes('Error') ? '#ff3b30' : '#34c759' }}>{uploadMsg}</div>}
                    {docs.length === 0 ? <p style={{ color: APPLE_MUTED, textAlign: 'center', padding: '40px 0', fontSize: 14 }}>Upload HOA bylaws and rules.</p> : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>{['Filename', 'Status', 'Uploaded', ''].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                        <tbody>
                          {docs.map(doc => (
                            <tr key={doc.id}>
                              <td style={tdStyle}>{doc.filename}</td>
                              <td style={tdStyle}><span style={{ color: doc.status === 'ready' ? '#34c759' : doc.status === 'error' ? '#ff3b30' : '#ff9500', fontWeight: 500 }}>{doc.status}</span></td>
                              <td style={tdStyle}>{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                              <td style={{ ...tdStyle, textAlign: 'right' }}>
                                {selected.status === 'active' && (
                                  <button onClick={() => handleDeleteDoc(doc.id)} style={{ color: '#ff3b30', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>Delete</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
                {tab === 'embed' && (
                  <>
                    <h3 style={{ color: APPLE_TEXT, marginBottom: 16, fontWeight: 500, fontSize: 18 }}>Embed Widget</h3>
                    {selected.status !== 'active' ? <div style={{ padding: 16, background: '#fffbeb', borderRadius: 12, color: '#d97706' }}>HOA must be active to use embed code.</div> : (
                      <>
                        <p style={{ color: APPLE_MUTED, marginBottom: 16, fontSize: 14 }}>Add this code before the closing body tag of your website.</p>
                        <div style={{ background: '#1d1d1f', color: '#f5f5f7', padding: 16, borderRadius: 12, marginBottom: 16, fontFamily: 'monospace', fontSize: 13, overflowX: 'auto' }}><code>{embedInfo?.embed_code}</code></div>
                        <button onClick={() => { navigator.clipboard.writeText(embedInfo?.embed_code || ''); setCopied(true); setTimeout(() => setCopied(false), 2000) }} style={{ padding: '8px 16px', background: APPLE_TEXT, color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>{copied ? 'Copied' : 'Copy Code'}</button>
                      </>
                    )}
                  </>
                )}
                {tab === 'chat' && (
                  <>
                    <h3 style={{ color: APPLE_TEXT, marginBottom: 8, fontWeight: 500, fontSize: 18 }}>Test Chat</h3>
                    {selected.status !== 'active' ? (
                      <div style={{ padding: 16, background: '#fffbeb', borderRadius: 12, color: '#d97706', marginBottom: 20 }}>HOA must be active to test the chat widget.</div>
                    ) : (
                      <>
                        <p style={{ color: APPLE_MUTED, fontSize: 14, marginBottom: 24 }}>A live test widget in the bottom right allows you to query your uploaded documents.</p>
                        <div style={{ background: APPLE_BG, borderRadius: 16, overflow: 'hidden', padding: 40, border: `1px solid ${APPLE_BORDER}` }}>
                          <div style={{ fontSize: 24, fontWeight: 600, color: APPLE_TEXT, marginBottom: 12, letterSpacing: -0.5 }}>{selected.name} Portal</div>
                          <p style={{ color: APPLE_MUTED, fontSize: 15, maxWidth: 480, lineHeight: 1.5 }}>Welcome to the portal. Access your documents and interact with our intelligent assistant by clicking the bottom right icon.</p>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {selected && selected.status === 'active' && <TestChatBubble community={selected} docs={docs} visible={tab === 'chat'} />}

      {/* Create Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: APPLE_CARD, backdropFilter: 'blur(20px)', borderRadius: 20, padding: 32, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 24px', color: APPLE_TEXT, fontWeight: 500, fontSize: 20 }}>New HOA</h3>
            {[{ label: 'Name', key: 'name' }, { label: 'Manager Name', key: 'manager_name' }, { label: 'Manager Email', key: 'manager_email' }, { label: 'Manager Phone', key: 'manager_phone' }, { label: 'Location', key: 'location' }].map(field => (
              <div key={field.key} style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: APPLE_MUTED, display: 'block', marginBottom: 6 }}>{field.label}</label>
                <input value={(form as any)[field.key]} onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))} style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box', border: `1px solid ${APPLE_BORDER}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 32 }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: '8px 16px', background: 'transparent', color: APPLE_TEXT, border: `1px solid ${APPLE_BORDER}`, borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating || !form.name || !form.manager_name || !form.manager_email || !form.manager_phone} style={{ padding: '8px 16px', background: APPLE_ACCENT, color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, opacity: (!form.name || !form.manager_name || !form.manager_email || !form.manager_phone) ? 0.5 : 1, fontWeight: 500 }}>{creating ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

const thStyle: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, color: APPLE_MUTED, fontWeight: 500, borderBottom: `1px solid ${APPLE_BORDER}` }
const tdStyle: React.CSSProperties = { padding: '16px', fontSize: 14, color: APPLE_TEXT, borderBottom: `1px solid ${APPLE_BORDER}` }
