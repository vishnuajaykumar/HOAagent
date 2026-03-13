import React, { useState, useRef, useEffect, useCallback } from 'react'

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

// Browser speech APIs
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
const synth = window.speechSynthesis

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

  // Voice state
  const [isListening, setIsListening] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [voiceSupported] = useState(!!SpeechRecognition)
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef<string>('')
  const currentAssistantId = useRef<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Speak assistant text aloud
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !synth) return
    synth.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 1
    utt.pitch = 1
    synth.speak(utt)
  }, [voiceEnabled])

  // Start mic listening
  const startListening = useCallback(() => {
    if (!SpeechRecognition || isListening || isLoading) return
    const rec = new SpeechRecognition()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      transcriptRef.current = transcript
      setInput(transcript)
    }

    rec.onend = () => {
      setIsListening(false)
      // Use ref to avoid race condition — React state may not have committed yet
      const text = transcriptRef.current
      transcriptRef.current = ''
      if (text.trim()) sendMessage(text)
    }

    rec.onerror = () => setIsListening(false)

    recognitionRef.current = rec
    rec.start()
    setIsListening(true)
  }, [isListening, isLoading])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const sendMessage = async (overrideInput?: string) => {
    const question = (overrideInput ?? input).trim()
    if (!question || isLoading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: question }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    const assistantId = (Date.now() + 1).toString()
    currentAssistantId.current = assistantId
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
      let fullAnswer = ''

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
                  fullAnswer += data.text
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
        fullAnswer = data.answer || 'No response'
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: fullAnswer } : m
        ))
      }

      // Speak response if voice output enabled
      if (fullAnswer) speak(fullAnswer)

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
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={s.avatar}>H</div>
          <div>
            <div style={s.headerTitle}>HOA Assistant</div>
            <div style={s.headerSub}>● Online</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Voice output toggle */}
          {voiceSupported && (
            <button
              onClick={() => { setVoiceEnabled(v => !v); synth?.cancel() }}
              title={voiceEnabled ? 'Turn off voice response' : 'Turn on voice response'}
              style={{ ...s.iconBtn, background: voiceEnabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)' }}
            >
              {voiceEnabled ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                </svg>
              )}
            </button>
          )}
          {!standalone && (
            <button style={s.closeBtn} onClick={() => { synth?.cancel(); setIsOpen(false) }}>✕</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={s.messages}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={msg.role === 'user' ? s.userBubble : s.botBubble}>
              {msg.content || (isLoading && msg.role === 'assistant' ? (
                <span style={{ opacity: 0.5 }}>▪ ▪ ▪</span>
              ) : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div style={s.inputRow}>
        {/* Mic button */}
        {voiceSupported && (
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={isLoading}
            title={isListening ? 'Stop listening' : 'Speak your question'}
            style={{
              ...s.micBtn,
              background: isListening ? '#ef4444' : '#f1f5f9',
              boxShadow: isListening ? '0 0 0 4px rgba(239,68,68,0.2)' : 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isListening ? 'white' : '#64748b'}>
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
        )}

        <input
          ref={inputRef}
          id="hoa-text-input"
          style={s.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Listening...' : 'Ask about your HOA rules...'}
          disabled={isLoading || isListening}
        />
        <button
          id="hoa-send-btn"
          style={{ ...s.send, opacity: isLoading || !input.trim() ? 0.5 : 1 }}
          onClick={() => sendMessage()}
          disabled={isLoading || !input.trim()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>

      <div style={s.footer}>
        {voiceSupported
          ? `Powered by HOAbot AI · ${voiceEnabled ? '🔊 Voice on' : '🔇 Voice off'}`
          : 'Powered by HOAbot AI'
        }
      </div>
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
    position: 'fixed', bottom: 24, right: 24, width: 380, height: 580,
    borderRadius: 16, background: 'white', display: 'flex', flexDirection: 'column',
    zIndex: 9999, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  standalone: {
    width: 420, height: 620, borderRadius: 16, background: 'white',
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
  iconBtn: {
    border: 'none', borderRadius: 8, cursor: 'pointer', padding: '6px 8px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
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
  micBtn: {
    width: 38, height: 38, borderRadius: '50%', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.2s',
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
