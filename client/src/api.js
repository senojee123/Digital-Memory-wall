import { io } from 'socket.io-client';

export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'mw_admin_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

/** Media URLs stored by the local driver may be relative to the API origin. */
export const mediaUrl = (u) => (u && u.startsWith('/') ? API + u : u);

async function request(path, { method = 'GET', body, auth, form } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${getToken()}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  events: () => request('/events'),
  event: (slug) => request(`/events/${slug}`),
  memories: (slug) => request(`/events/${slug}/memories`),
  story: (slug) => request(`/events/${slug}/story`),
  submit: (form) => request('/memories', { method: 'POST', form }),

  login: (password) => request('/auth/login', { method: 'POST', body: { password } }),
  adminMemories: (eventId) => request(`/admin/events/${eventId}/memories`, { auth: true }),
  updateMemory: (id, patch) => request(`/admin/memories/${id}`, { method: 'PATCH', body: patch, auth: true }),
  deleteMemory: (id) => request(`/admin/memories/${id}`, { method: 'DELETE', auth: true }),
  regenerate: (id) => request(`/admin/memories/${id}/regenerate`, { method: 'POST', auth: true }),
  updateSettings: (eventId, s) => request(`/admin/events/${eventId}/settings`, { method: 'PUT', body: s, auth: true }),
  createEvent: (name) => request('/admin/events', { method: 'POST', body: { name }, auth: true }),
  film: (eventId) => request(`/admin/events/${eventId}/film`, { auth: true }),
  makeFilm: (eventId) => request(`/admin/events/${eventId}/film`, { method: 'POST', auth: true }),
  generateStory: (eventId) => request(`/admin/events/${eventId}/story`, { method: 'POST', auth: true }),
};

export function connectSocket({ slug, admin } = {}) {
  const socket = io(API || undefined, { auth: admin ? { token: getToken() } : {} });
  // Re-join on every (re)connect so a dropped venue Wi-Fi never leaves the wall stale.
  socket.on('connect', () => slug && socket.emit('join', slug));
  return socket;
}

export const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
