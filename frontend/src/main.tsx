import React from 'react'
import ReactDOM from 'react-dom/client'
import ChatWidget from './components/ChatWidget'

const params = new URLSearchParams(window.location.search)
const apiKey = params.get('key') || 'demo'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
      <h1 style={{ color: '#1a365d', marginBottom: '8px' }}>HOAbot Demo</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>AI assistant for HOA communities</p>
      <ChatWidget apiKey={apiKey} standalone={true} />
    </div>
  </React.StrictMode>
)
