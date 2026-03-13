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
    throw new Error(`${res.status}: ${err.detail || 'Request failed'}`)
  }
  return res.json()
}

export const superLogin = (email: string, password: string) =>
  request('/auth/super/login', { method: 'POST', body: JSON.stringify({ email, password }) }, '')

export const clientLogin = (email: string, password: string) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, '')

export const clientSignup = (company_name: string, email: string, password: string) =>
  request('/auth/signup', { method: 'POST', body: JSON.stringify({ company_name, email, password }) }, '')

export const getClients = () => request('/super/clients', {}, 'super_token')
export const approveClient = (id: string) => request(`/super/clients/${id}/approve`, { method: 'PUT' }, 'super_token')
export const suspendClient = (id: string) => request(`/super/clients/${id}/suspend`, { method: 'PUT' }, 'super_token')
export const cancelClient = (id: string) => request(`/super/clients/${id}/cancel`, { method: 'PUT' }, 'super_token')
export const setLimits = (id: string, limit: number) =>
  request(`/super/clients/${id}/limits`, { method: 'PUT', body: JSON.stringify({ token_limit_monthly: limit }) }, 'super_token')
export const setTier = (id: string, tier: string) =>
  request(`/super/clients/${id}/tier`, { method: 'PUT', body: JSON.stringify({ model_tier: tier }) }, 'super_token')
export const getAllUsage = () => request('/super/usage', {}, 'super_token')

export const getMe = () => request('/client/me')
export const getUsage = () => request('/client/usage')
export const getEmbedCode = () => request('/client/embed-code')
export const getDocuments = () => request('/client/documents')

export const uploadDocument = async (file: File, communityId?: string) => {
  const token = getToken('client_token')
  const formData = new FormData()
  formData.append('file', file)
  const url = `${API}/client/documents/upload${communityId ? `?community_id=${communityId}` : ''}`
  const res = await fetch(url, {
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
