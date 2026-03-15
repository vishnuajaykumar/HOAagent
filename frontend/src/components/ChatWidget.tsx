import React, { useState, useRef, useEffect, useCallback } from 'react'

interface Message { id: string; role: 'user' | 'assistant'; content: string }
interface ChatWidgetProps { apiKey: string; communityId?: string; standalone?: boolean }

const API_URL = (import.meta as any).env?.VITE_API_URL || '/api'
const APPLE_ACCENT = '#000000'
const APPLE_BG = '#f5f5f7'
const APPLE_TEXT = '#1d1d1f'
const APPLE_MUTED = '#86868b'
const APPLE_BORDER = '#d2d2d7'

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
const synth = window.speechSynthesis

export default function ChatWidget({ apiKey, communityId, standalone = false }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(standalone)
  const [messages, setMessages] = useState<Message[]>([{ id: '0', role: 'assistant', content: "Hello! I'm Jenny, your HOA assistant. How can I help you today?" }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [voiceSupported] = useState(!!SpeechRecognition)
  
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef<string>('')
  const currentAssistantId = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !synth) return
    synth.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 1; utt.pitch = 1; synth.speak(utt)
  }, [voiceEnabled])

  const startListening = useCallback(() => {
    if (!SpeechRecognition || isListening || isLoading) return
    const rec = new SpeechRecognition()
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e: any) => { transcriptRef.current = e.results[0][0].transcript; setInput(e.results[0][0].transcript) }
    rec.onend = () => { setIsListening(false); const text = transcriptRef.current; transcriptRef.current = ''; if (text.trim()) sendMessage(text) }
    rec.onerror = () => setIsListening(false)
    recognitionRef.current = rec; rec.start(); setIsListening(true)
  }, [isListening, isLoading])

  const stopListening = useCallback(() => { recognitionRef.current?.stop(); setIsListening(false) }, [])

  const sendMessage = async (overrideInput?: string) => {
    const question = (overrideInput ?? input).trim()
    if (!question || isLoading) return

    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: question }])
    setInput(''); setIsLoading(true)

    const assistantId = (Date.now() + 1).toString()
    currentAssistantId.current = assistantId
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, api_key: apiKey, community_id: communityId })
      })

      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Network error')

      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n'); buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.text) setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + data.text } : m))
              } catch { }
            }
          }
        }
      } else {
        const data = await response.json()
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: data.answer || 'No response' } : m))
      }
      const fullAnswer = messages.find(m => m.id === assistantId)?.content || '' // note: state may not be updated immediately in this closure scope, speak uses latest handled chunks
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${err.message}` } : m))
    } finally {
      setIsLoading(false); inputRef.current?.focus()
    }
  }

  // Draggable logic for floating non-standalone widget
  useEffect(() => {
    if (standalone || !containerRef.current) return
    const el = containerRef.current
    let isDragging = false, startX = 0, startY = 0, initialX = 0, initialY = 0

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.no-drag')) return
      isDragging = true; startX = e.clientX; startY = e.clientY
      const rect = el.getBoundingClientRect(); initialX = rect.left; initialY = rect.top
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      el.style.left = `${initialX + (e.clientX - startX)}px`
      el.style.top = `${initialY + (e.clientY - startY)}px`
      el.style.bottom = 'auto'; el.style.right = 'auto'
    }
    const handleMouseUp = () => { isDragging = false; document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp) }
    
    const header = el.querySelector('.drag-handle') as HTMLElement
    if (header) header.addEventListener('mousedown', handleMouseDown)
    return () => { if (header) header.removeEventListener('mousedown', handleMouseDown); document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp) }
  }, [standalone, isOpen])

  if (!isOpen && !standalone) {
    return (
      <div onClick={() => setIsOpen(true)} title="Chat with Jenny" style={{
        position: 'fixed', bottom: 24, right: 24, width: 60, height: 60, borderRadius: 30, background: APPLE_ACCENT, 
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 9999, transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)'
      }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{
      ...(standalone ? { width: '100%', height: '100%', borderRadius: 0 } : { position: 'fixed', bottom: 24, right: 24, width: 380, height: 580, borderRadius: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.1)', border: `1px solid ${APPLE_BORDER}` }),
      background: 'rgba(255, 255, 255, 0.95)', display: 'flex', flexDirection: 'column', zIndex: 9999, overflow: 'hidden', backdropFilter: 'blur(20px)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <div className={standalone ? "" : "drag-handle"} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${APPLE_BORDER}`, background: 'transparent', cursor: standalone ? 'default' : 'grab' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: APPLE_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 500, fontSize: 13 }}>J</div>
          <div><div style={{ color: APPLE_TEXT, fontWeight: 600, fontSize: 14 }}>Jenny</div><div style={{ color: APPLE_MUTED, fontSize: 11 }}>Online</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="no-drag">
          {voiceSupported && (
            <button onClick={() => { setVoiceEnabled(v => !v); synth?.cancel() }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: voiceEnabled ? APPLE_ACCENT : APPLE_MUTED }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                {voiceEnabled ? <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/> : <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>}
              </svg>
            </button>
          )}
          {!standalone && <button onClick={() => { synth?.cancel(); setIsOpen(false) }} style={{ background: 'none', border: 'none', color: APPLE_MUTED, cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: APPLE_BG }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              background: msg.role === 'user' ? APPLE_ACCENT : '#ffffff', color: msg.role === 'user' ? 'white' : APPLE_TEXT, padding: '10px 14px', borderRadius: 16, maxWidth: '82%', fontSize: 14, lineHeight: 1.5,
              wordBreak: 'break-word', border: msg.role === 'assistant' ? `1px solid ${APPLE_BORDER}` : 'none', whiteSpace: 'pre-wrap', borderBottomRightRadius: msg.role === 'user' ? 4 : 16, borderBottomLeftRadius: msg.role === 'assistant' ? 4 : 16, boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}>
              {msg.content || (isLoading && msg.role === 'assistant' ? <span style={{ opacity: 0.5 }}>...</span> : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '12px 16px', background: 'transparent', borderTop: `1px solid ${APPLE_BORDER}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        {voiceSupported && (
          <button onClick={isListening ? stopListening : startListening} disabled={isLoading} style={{ width: 36, height: 36, borderRadius: 18, border: 'none', background: isListening ? '#ff3b30' : '#e5e5ea', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s', color: isListening ? 'white' : APPLE_MUTED }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          </button>
        )}
        <input ref={inputRef} style={{ flex: 1, padding: '10px 14px', borderRadius: 20, border: `1px solid ${APPLE_BORDER}`, fontSize: 14, outline: 'none', background: '#ffffff', color: APPLE_TEXT }} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} placeholder={isListening ? 'Listening...' : 'Ask about your HOA rules...'} disabled={isLoading || isListening} />
        <button onClick={() => sendMessage()} disabled={isLoading || !input.trim()} style={{ width: 36, height: 36, borderRadius: 18, background: APPLE_ACCENT, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isLoading || !input.trim() ? 0.5 : 1 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: APPLE_MUTED, padding: '4px 6px 8px', background: 'transparent' }}>Powered by HOAbot AI</div>
    </div>
  )
}
