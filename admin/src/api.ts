const API = (import.meta as any).env?.VITE_API_URL || '/api'

function getToken(key: string) {
  return localStorage.getItem(key) || ''
}

async function request(path: string, options: RequestInit = {}, tokenKey = 'client_token') {
  const token = getToken(tokenKey)
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> || {})
    }
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    let msg = err.detail || 'Request failed'
    if (Array.isArray(msg)) {
      msg = msg.map((m: any) => m.msg || JSON.stringify(m)).join(', ')
    } else if (typeof msg === 'object') {
      msg = JSON.stringify(msg)
    }
    throw new Error(`${res.status}: ${msg}`)
  }
  return res.json()
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export const superLogin = (email: string, password: string) =>
  request('/auth/super/login', { method: 'POST', body: JSON.stringify({ email, password }) }, '')

export const clientLogin = (email: string, password: string) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, '')

export const clientSignup = (company_name: string, email: string, password: string) =>
  request('/auth/signup', { method: 'POST', body: JSON.stringify({ company_name, email, password }) }, '')

// ─── Super Admin ───────────────────────────────────────────────────────────────
export const getClients = () => request('/super/clients', {}, 'super_token')
export const suspendClient = (id: string) => request(`/super/clients/${id}/suspend`, { method: 'PUT' }, 'super_token')
export const activateClient = (id: string) => request(`/super/clients/${id}/activate`, { method: 'PUT' }, 'super_token')
export const archiveClient = (id: string) => request(`/super/clients/${id}/archive`, { method: 'PUT' }, 'super_token')
export const setLimits = (id: string, limit: number) =>
  request(`/super/clients/${id}/limits`, { method: 'PUT', body: JSON.stringify({ token_limit_monthly: limit }) }, 'super_token')
export const getAllUsage = () => request('/super/usage', {}, 'super_token')

// Super Admin HOA (Community) actions
export const approveCommunity = (id: string) => request(`/super/communities/${id}/approve`, { method: 'PUT' }, 'super_token')
export const suspendCommunity = (id: string) => request(`/super/communities/${id}/suspend`, { method: 'PUT' }, 'super_token')
export const archiveCommunity = (id: string) => request(`/super/communities/${id}/archive`, { method: 'PUT' }, 'super_token')
export const setCommunityAI = (id: string, provider: string, model: string) =>
  request(`/super/communities/${id}/ai`, { method: 'PUT', body: JSON.stringify({ ai_provider: provider, ai_model: model }) }, 'super_token')
export const getAIModels = () => request('/super/ai/models', {}, 'super_token')
export const deleteCommunitySuper = (id: string) => request(`/super/communities/${id}`, { method: 'DELETE' }, 'super_token')

// ─── Management Company ────────────────────────────────────────────────────────
export const getMe = () => request('/client/me')
export const getUsage = () => request('/client/usage')

// HOA (Community) CRUD
export const getCommunities = () => request('/client/communities')
export const createCommunity = (data: { name: string; manager_name?: string; manager_email?: string; location?: string }) =>
  request('/client/communities', { method: 'POST', body: JSON.stringify(data) })
export const updateCommunity = (id: string, data: { name?: string; manager_name?: string; manager_email?: string; location?: string }) =>
  request(`/client/communities/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteCommunity = (id: string) => request(`/client/communities/${id}`, { method: 'DELETE' })

// Documents per HOA
export const getCommunityDocuments = (communityId: string) => request(`/client/communities/${communityId}/documents`)
export const getEmbedCode = (communityId: string) => request(`/client/communities/${communityId}/embed-code`)

export const uploadDocument = async (file: File, communityId: string) => {
  const token = getToken('client_token')
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API}/client/communities/${communityId}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail)
  }
  return res.json()
}

export const deleteDocument = (communityId: string, documentId: string) =>
  request(`/client/communities/${communityId}/documents/${documentId}`, { method: 'DELETE' })
