import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { getMe, getUsage, getEmbedCode, getDocuments, uploadDocument } from '../api'

export default function ClientDashboard() {
  const navigate = useNavigate()
  const [me, setMe] = useState<any>(null)
  const [usage, setUsage] = useState<any>(null)
  const [embedCode, setEmbedCode] = useState('')
  const [documents, setDocuments] = useState<any[]>([])
  const [tab, setTab] = useState<'overview' | 'documents' | 'embed'>('overview')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!localStorage.getItem('client_token')) navigate('/admin/login')
  }, [])

  const load = async () => {
    try {
      const [m, u, e, d] = await Promise.all([getMe(), getUsage(), getEmbedCode(), getDocuments()])
      setMe(m); setUsage(u); setEmbedCode(e.embed_code); setDocuments(d)
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('403')) navigate('/admin/login')
    }
  }

  useEffect(() => { load() }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadMsg('')
    try {
      const r = await uploadDocument(file)
      setUploadMsg(`✓ Uploaded successfully (${r.chunks} chunks processed)`)
      load()
    } catch (err: any) {
      setUploadMsg(`✗ ${err.message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!me) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

  const pct = me.usage_percent || 0

  return (
    <Layout title={me.company_name} role="client">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
        {[
          { label: 'Tokens Used', value: `${(me.tokens_used_this_month / 1000).toFixed(1)}K` },
          { label: 'Monthly Limit', value: `${(me.token_limit_monthly / 1000).toFixed(0)}K` },
          { label: 'Usage', value: `${pct}%`, color: pct > 90 ? '#ef4444' : '#22c55e' },
          { label: 'Documents', value: documents.length },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', padding: 20, borderRadius: 12, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color || '#1e293b' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#f1f5f9', borderRadius: 4, height: 6, marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct > 90 ? '#ef4444' : '#2563eb', borderRadius: 4 }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['overview', 'documents', 'embed'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 20px', border: '1.5px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              background: tab === t ? '#2563eb' : 'white', color: tab === t ? 'white' : '#64748b', borderColor: tab === t ? '#2563eb' : '#e2e8f0' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
        {tab === 'overview' && (
          <>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 20 }}>Recent Activity</h3>
            {!usage?.recent_logs?.length ? (
              <p style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>No conversations yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Question', 'Tokens In', 'Tokens Out', 'Date'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {usage.recent_logs.map((log: any, i: number) => (
                    <tr key={i}>
                      <td style={td}>{log.question?.slice(0, 60)}...</td>
                      <td style={td}>{log.tokens_input}</td>
                      <td style={td}>{log.tokens_output}</td>
                      <td style={td}>{new Date(log.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'documents' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: 0 }}>HOA Documents</h3>
              <label style={{ padding: '8px 16px', background: '#2563eb', color: 'white', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                {uploading ? 'Uploading...' : '+ Upload PDF'}
                <input ref={fileRef} type="file" accept=".pdf" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
              </label>
            </div>
            {uploadMsg && <div style={{ marginBottom: 12, fontSize: 14, color: uploadMsg.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{uploadMsg}</div>}
            {!documents.length ? (
              <p style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>No documents yet. Upload your HOA bylaws and rules PDFs to get started.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Filename', 'Status', 'Uploaded'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {documents.map((doc: any) => (
                    <tr key={doc.id}>
                      <td style={td}>📄 {doc.filename}</td>
                      <td style={td}><span style={{ color: doc.status === 'ready' ? '#22c55e' : doc.status === 'error' ? '#ef4444' : '#f59e0b' }}>{doc.status}</span></td>
                      <td style={td}>{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'embed' && (
          <>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 12 }}>Embed Your Widget</h3>
            <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>
              Paste this into your HOA portal's HTML, just before the closing &lt;/body&gt; tag.
            </p>
            <div style={{ background: '#0f172a', color: '#7dd3fc', padding: 16, borderRadius: 8, marginBottom: 12, overflowX: 'auto', fontSize: 13, wordBreak: 'break-all' }}>
              <code>{embedCode}</code>
            </div>
            <button onClick={copyEmbed} style={{ padding: '10px 20px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, marginBottom: 24 }}>
              {copied ? '✓ Copied!' : 'Copy Code'}
            </button>
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8 }}>
              <h4 style={{ marginBottom: 8, color: '#1e293b' }}>How it works:</h4>
              <ol style={{ paddingLeft: 20, fontSize: 14, color: '#64748b', lineHeight: 2 }}>
                <li>Upload your HOA documents in the Documents tab</li>
                <li>Paste the embed code above into your portal's HTML</li>
                <li>A chat bubble appears in the bottom-right corner</li>
                <li>Residents ask questions — answered from your HOA docs only</li>
              </ol>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

const td: React.CSSProperties = { padding: '12px', fontSize: 14, color: '#1e293b', borderBottom: '1px solid #f1f5f9' }
