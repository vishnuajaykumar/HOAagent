import React from 'react'
import ReactDOM from 'react-dom/client'
import ChatWidget from './components/ChatWidget'

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return <div style={{color: 'red', padding: 20}}><h1>App Crashed!</h1><pre>{String(this.state.error)}</pre></div>;
    return this.props.children;
  }
}

const params = new URLSearchParams(window.location.search)
const apiKey = params.get('key') || 'demo'
const isEmbed = params.get('embed') === 'true'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isEmbed ? (
        <ChatWidget apiKey={apiKey} standalone={true} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
          <h1 style={{ color: '#1a365d', marginBottom: '8px' }}>HOAbot Demo</h1>
          <p style={{ color: '#666', marginBottom: '32px' }}>AI assistant for HOA communities</p>
          <ChatWidget apiKey={apiKey} standalone={true} />
        </div>
      )}
    </ErrorBoundary>
  </React.StrictMode>
)
