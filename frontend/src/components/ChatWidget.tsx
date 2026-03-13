import React, { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ChatWidgetProps {
  apiKey: string
  communityId?: string
  standalone?: boolean
}

const API_URL = (import.meta as any).env?.VITE_API_URL || '/api'
const BLUE = '#2563eb'
const DARK = '#1e293b'

export default function ChatWidget({ apiKey, communityId, standalone = false }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(standalone)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: "Hello! I'm your HOA assistant. I can answer questions about your community's bylaws, rules, and regulations. How can I help you today?"
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const question = input.trim()
    if (!question || isLoading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: question }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, api_key: apiKey, community_id: communityId })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Request failed')
      }

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('text/event-stream')) {
        const reader = response.body!.getReader()
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
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: m.content + data.text } : m
                  ))
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      } else {
        const data = await response.json()
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: data.answer || 'No response' } : m
        ))
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `Sorry, something went wrong: ${err.message}` } : m
      ))
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!isOpen && !standalone) {
    return (
      <div style={s.bubble} onClick={() => setIsOpen(true)} title="Chat with HOA Assistant">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
      </div>
    )
  }

  return (
    <div style={standalone ? s.standalone : s.floating}>
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={s.avatar}>H</div>
          <div>
            <div style={s.headerTitle}>HOA Assistant</div>
            <div style={s.headerSub}>● Online</div>
          </div>
        </div>
        {!standalone && (
          <button style={s.closeBtn} onClick={() => setIsOpen(false)}>✕</button>
        )}
      </div>

      <div style={s.messages}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={msg.role === 'user' ? s.userBubble : s.botBubble}>
              {msg.content || (isLoading && msg.role === 'assistant' ? '...' : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={s.inputRow}>
        <input
          ref={inputRef}
          style={s.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your HOA rules..."
          disabled={isLoading}
        />
        <button
          style={{ ...s.send, opacity: isLoading || !input.trim() ? 0.5 : 1 }}
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div style={s.footer}>Powered by HOAbot AI</div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  bubble: {
    position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
    borderRadius: '50%', background: BLUE, display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', zIndex: 9999,
    boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
  },
  floating: {
    position: 'fixed', bottom: 24, right: 24, width: 380, height: 560,
    borderRadius: 16, background: 'white', display: 'flex', flexDirection: 'column',
    zIndex: 9999, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  standalone: {
    width: 420, height: 600, borderRadius: 16, background: 'white',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.12)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    background: BLUE, padding: '16px 20px', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between',
  },
  avatar: {
    width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'white', fontWeight: 700, fontSize: 16,
  },
  headerTitle: { color: 'white', fontWeight: 600, fontSize: 15 },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  closeBtn: { background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18, padding: 4 },
  messages: {
    flex: 1, overflowY: 'auto', padding: 16, display: 'flex',
    flexDirection: 'column', gap: 12, background: '#f8fafc',
  },
  userBubble: {
    background: BLUE, color: 'white', padding: '10px 14px',
    borderRadius: '16px 16px 4px 16px', maxWidth: '80%', fontSize: 14,
    lineHeight: 1.5, wordBreak: 'break-word',
  },
  botBubble: {
    background: 'white', color: DARK, padding: '10px 14px',
    borderRadius: '16px 16px 16px 4px', maxWidth: '80%', fontSize: 14,
    lineHeight: 1.5, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    wordBreak: 'break-word', whiteSpace: 'pre-wrap',
  },
  inputRow: {
    padding: '12px 16px', background: 'white', borderTop: '1px solid #e2e8f0',
    display: 'flex', gap: 8, alignItems: 'center',
  },
  input: {
    flex: 1, padding: '10px 14px', borderRadius: 24, border: '1.5px solid #e2e8f0',
    fontSize: 14, outline: 'none', background: '#f8fafc', color: DARK,
  },
  send: {
    width: 40, height: 40, borderRadius: '50%', background: BLUE, border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  footer: { textAlign: 'center', fontSize: 11, color: '#94a3b8', padding: 6, background: 'white', borderTop: '1px solid #f1f5f9' },
}
