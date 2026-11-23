import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Eye, Plus, X, Clock, Shield, Bell, Activity, Key, Users, Check, RefreshCw, Copy, UserPlus, Info, Search, Edit2, Trash2 } from 'feather-icons-react';
import { getAvatarUrl } from '../utils/url';
import '../css/SecurityCenter.css';
function Avatar({ src, name = '' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
  return <span className="sc-avatar">{src && !broken
    ? <img src={getAvatarUrl(src)} alt="" onError={() => setBroken(true)}/>
    : initials}</span>;
}
const clientHintsReady = typeof navigator !== 'undefined' && navigator.userAgentData?.getHighEntropyValues
  ? navigator.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']).catch(() => ({}))
  : Promise.resolve({});
const localIpReady = new Promise(resolve => {
  if (typeof RTCPeerConnection === 'undefined') return resolve('');
  try {
    const peer = new RTCPeerConnection({ iceServers: [] });
    let settled = false;
    const finish = ip => { if (settled) return; settled = true; peer.close(); resolve(ip); };
    const timeout = setTimeout(() => finish(''), 900);
    peer.onicecandidate = e => {
      const ip = e.candidate?.candidate?.match(/\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/)?.[0];
      if (ip) { clearTimeout(timeout); finish(ip); }
      else if (!e.candidate) { clearTimeout(timeout); finish(''); }
    };
    peer.createDataChannel('local-ip');
    peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => { clearTimeout(timeout); finish(''); });
  } catch { resolve(''); }
});
const api = async (path, options = {}) => {
  const [hints, localIp] = await Promise.all([clientHintsReady, localIpReady]);
  const browser = hints.fullVersionList?.find(x => /Google Chrome|Microsoft Edge|Firefox/i.test(x.brand))?.brand || '';
  const response = await fetch(`/api/security${path}`, { credentials: 'include', cache: 'no-store',
    ...options, headers: { 'Content-Type': 'application/json',
      'X-Client-Platform-Version': hints.platformVersion || '', 'X-Client-Browser': browser, 'X-Client-Local-IP': localIp,
      ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la operación'),
    { status: response.status, attempt_id: data.attempt_id });
  return data;
};
const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const auditDate = value => {
  const parsed = new Date(String(value || '').replace(' ', 'T') + (String(value || '').includes('Z') ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? String(value || '—') : new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(parsed);
};
const auditDetail = value => { try { return typeof value === 'string' ? JSON.parse(value) : (value || {}); } catch { return {}; } };
const utcDateMs = value => {
  if (!value) return 0;
  const raw = String(value);
  return Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`) || 0;
};
const deviceDescription = (value, detail = {}) => {
  const ua = String(value || '');
  if (!ua) return 'No disponible';
  const browser = /Edg\//i.test(ua) ? 'Microsoft Edge' : /Firefox\//i.test(ua) ? 'Firefox' :
    /Chrome\//i.test(ua) ? 'Google Chrome' : /Safari\//i.test(ua) ? 'Safari' : detail.clientDevice?.browser || 'Navegador desconocido';
  const winVersion = Number.parseInt(detail.clientDevice?.platformVersion, 10);
  const system = /Windows/i.test(ua) ? (Number.isFinite(winVersion) && winVersion > 0 ? `Windows ${winVersion >= 13 ? '11' : '10'}` : 'Windows 10/11') : /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad/i.test(ua) ? 'iOS' : /Macintosh|Mac OS/i.test(ua) ? 'macOS' :
      /Linux/i.test(ua) ? 'Linux' : 'Sistema desconocido';
  return `${browser} · ${system}`;
};
const emptyForm = { plataforma: 'CRM', cuenta: '', nombre: '', responsable_id: '', clave: '', proyecto_id: '' };
export default function SecurityCenter({ usuario }) {
  const permissions = usuario?.rol_permisos || [];
  const canManage = permissions.includes('gestionar_credenciales_2fa');
  const canRegister = true;
  const canHours = permissions.includes('gestionar_horarios_2fa');
  const canAudit = permissions.includes('ver_auditoria_seguridad');
  const canAlerts = permissions.includes('gestionar_alertas_2fa');
  const [tab, setTab] = useState('codes');
  const [credentials, setCredentials] = useState([]);
  const [users, setUsers] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [telegramSetup, setTelegramSetup] = useState(null);
  const [telegramGroup, setTelegramGroup] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [auditFilter, setAuditFilter] = useState({ usuario_id: '', event_type: '', result: '', plataforma: '', from: '', to: '' });
  const [exceptions, setExceptions] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [exceptionForm, setExceptionForm] = useState({ local_date: '', enabled: false, start_time: '08:00', end_time: '18:00', reason: '', usuario_id: '' });
  const [codeItem, setCodeItem] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [accessInfo, setAccessInfo] = useState(null);
  const [assignItem, setAssignItem] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [modal, setModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editOwnerSearch, setEditOwnerSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revealed, setRevealed] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [query, setQuery] = useState('');
  const [stepUp, setStepUp] = useState(null);
  const stepUpRef = useRef(null);
  stepUpRef.current = stepUp;
  const timers = useRef({});
  const activeViews = useRef({});
  const grants = useRef({});
  const revealRequest = useRef(0);
  const telegramErrorAt = useRef(0);
  const cancelAttempt = ({ item, attemptId } = {}) => {
    if (!Number.isSafeInteger(Number(item?.id)) || !Number.isSafeInteger(Number(attemptId))) return;
    void fetch(`/api/security/credentials/${Number(item.id)}/attempts/${Number(attemptId)}/cancel`, {
      method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
  };
  useEffect(() => {
    const onPageHide = () => { if (stepUpRef.current) cancelAttempt(stepUpRef.current); };
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); if (stepUpRef.current) cancelAttempt(stepUpRef.current); };
  }, []);
  const closeStepUp = () => { cancelAttempt(stepUp); stepUpRef.current = null; revealRequest.current += 1; setStepUp(null); };
  useEffect(() => { const tick = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(tick); }, []);
  const clearCodes = useCallback(() => {
    revealRequest.current += 1; Object.values(timers.current).forEach(clearTimeout); timers.current = {}; activeViews.current = {}; grants.current = {}; setRevealed({}); setCodeItem(null); setRefreshing(false);
  }, []);
  useEffect(() => {
    const hide = () => { if (document.hidden) clearCodes(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', clearCodes);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', clearCodes); clearCodes(); };
  }, [clearCodes]);
  useEffect(() => { clearCodes(); }, [tab, clearCodes]);
  useEffect(() => { setError(''); setNotice(''); }, [tab]);
  const load = useCallback(async () => {
    try {
      const [codes, setting] = await Promise.all([api('/credentials'), api('/policy')]);
      setCredentials(codes.credentials); setPolicy(setting);
      if (canManage || canHours || canAudit) setUsers((await api('/users')).users);
    } catch (e) { setError(e.message); }
  }, [canManage, canHours, canAudit]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab === 'audit' && canAudit) {
      const filters = new URLSearchParams({ ...Object.fromEntries(Object.entries(auditFilter).filter(([,v]) => v)), event_type: auditFilter.event_type || 'CODE_CONSULTATIONS' });
      api(`/audit?${filters}`).then(a => setEvents(a.events)).catch(e => setError(e.message));
    }
    if (tab === 'hours' && canHours) api('/exceptions').then(d => setExceptions(d.exceptions)).catch(e => setError(e.message));
    if (tab === 'alerts' && canAlerts) {
      api('/alerts').then(data => { setAlerts(data); setTelegramStatus(data); }).catch(e => setError(e.message));
      api('/alerts/setup').then(setTelegramSetup).catch(e => setError(e.message));
    }
  }, [tab, canAudit, canHours, canAlerts, auditFilter]);
  useEffect(() => {
    if (tab !== 'alerts' || !canAlerts) return;
    const refresh = () => api('/alerts').then(setTelegramStatus).catch(() => {});
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [tab, canAlerts]);
  useEffect(() => {
    if (tab === 'alerts' && error.startsWith('La VPS no pudo conectarse con Telegram')) telegramErrorAt.current = Date.now();
  }, [tab, error]);
  useEffect(() => {
    if (tab === 'alerts' && error.startsWith('La VPS no pudo conectarse con Telegram') &&
      telegramErrorAt.current && utcDateMs(telegramStatus?.last_success_at) > telegramErrorAt.current) {
      setError('');
    }
  }, [tab, error, telegramStatus?.last_success_at]);
  useEffect(() => {
    if (tab !== 'alerts' || !canAlerts || telegramSetup?.command || !telegramStatus?.bot_configured ||
      !telegramStatus?.last_success_at ||
      utcDateMs(telegramStatus.last_success_at) <= utcDateMs(telegramStatus.last_error_at)) return;
    let cancelled = false;
    api('/alerts/setup').then(data => { if (!cancelled) setTelegramSetup(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tab, canAlerts, telegramSetup?.command, telegramStatus?.bot_configured, telegramStatus?.last_success_at, telegramStatus?.last_error_at]);
  async function act(fn, message) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(message); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function register(e) {
    e.preventDefault();
    await act(async () => {
      await api('/credentials', { method: 'POST', body: JSON.stringify({ ...form,
        responsable_id: Number(form.responsable_id) || usuario.id, proyecto_id: Number(form.proyecto_id) || null }) });
      setForm(emptyForm); setModal(false);
    }, 'Credencial registrada correctamente. La clave ya no se mostrará.');
  }
  async function updateCredential(e) {
    e.preventDefault();
    await act(async () => {
      await api(`/credentials/${editItem.id}`, { method: 'PUT', body: JSON.stringify({ ...editForm,
        responsable_id: Number(editForm.responsable_id) }) });
      setEditItem(null);
    }, 'Credencial actualizada');
  }
  const openEdit = item => {
    setEditForm({ plataforma: item.plataforma, cuenta: item.cuenta, nombre: item.nombre,
      responsable_id: String(item.responsable_id), clave: '', proyecto_id: item.proyecto_id || '' });
    setEditItem(item); setEditOwnerSearch(''); setError('');
  };
  const deleteCredential = async item => {
    if (!window.confirm(`¿Eliminar la credencial ${item.plataforma} · ${item.cuenta}? Esta acción revoca el acceso y conserva el registro de auditoría.`)) return;
    await act(async () => { await api(`/credentials/${item.id}`, { method: 'DELETE' }); clearCodes(); }, 'Credencial eliminada');
  };
  const hideCode = (credentialId) => {
    clearTimeout(timers.current[credentialId]);
    delete timers.current[credentialId];
    delete activeViews.current[credentialId];
    setRevealed(prev => { const copy = { ...prev }; delete copy[credentialId]; return copy; });
  };
  const closeCode = () => { revealRequest.current += 1; if (codeItem) hideCode(codeItem.id); setCodeItem(null); setRefreshing(false); setRefreshMessage(''); setCopied(false); };
  const openDetail = async (item) => {
    setDetailItem(item); setAccessInfo(null); setError('');
    try { setAccessInfo(await api(`/credentials/${item.id}/access`)); }
    catch (e) { setError(e.message); }
  };
  const openAssign = async (item) => {
    setAssignItem(item); setMemberSearch(''); setSelectedMembers([]); setError('');
    try { setAccessInfo(await api(`/credentials/${item.id}/access`)); }
    catch (e) { setError(e.message); }
  };
  const saveMembers = async () => {
    if (!assignItem || !selectedMembers.length) return;
    await act(async () => {
      for (const userId of selectedMembers) await api(`/credentials/${assignItem.id}/access/${userId}`, {
        method: 'PUT', body: JSON.stringify({ enabled: true }),
      });
      setAccessInfo(await api(`/credentials/${assignItem.id}/access`));
      setAssignItem(null); setSelectedMembers([]);
    }, 'Accesos asignados correctamente');
  };
  const scheduleRefresh = (item, token, expiresAt, remainingMs) => {
    clearTimeout(timers.current[item.id]);
    timers.current[item.id] = setTimeout(async () => {
      if (activeViews.current[item.id] !== token) return;
      if (document.hidden || Date.now() >= expiresAt) { hideCode(item.id); return; }
      try {
        const next = await api(`/credentials/${item.id}/current`, {
          method: 'POST', body: JSON.stringify({ view_token: token }),
        });
        if (activeViews.current[item.id] !== token) return;
        const nextAt = Date.now() + next.remaining_ms;
        setRefreshMessage('');
        setRevealed(prev => prev[item.id]
          ? { ...prev, [item.id]: { code: next.code, nextAt, token, expiresAt } } : prev);
        scheduleRefresh(item, token, expiresAt, next.remaining_ms);
      } catch (e) { delete grants.current[item.id]; hideCode(item.id); setCodeItem(null); setError(e.message); }
    }, Math.max(100, remainingMs + 30));
  };
  async function reveal(item, mfaCode = '', attemptId = null) {
    setError('');
    setRefreshMessage(''); setRefreshing(false);
    setCodeItem(item);
    const request = ++revealRequest.current;
    try {
      const cached = !mfaCode && grants.current[item.id];
      const reusable = cached && cached.expiresAt > Date.now() + 1000;
      const [response] = await Promise.all([
        reusable ? api(`/credentials/${item.id}/current`, { method: 'POST',
          body: JSON.stringify({ view_token: cached.token }) }) :
          api(`/credentials/${item.id}/reveal`, { method: 'POST', body: JSON.stringify({ codigo_mfa: mfaCode, attempt_id: attemptId }) }),
        new Promise(resolve => setTimeout(resolve, 550)),
      ]);
      if (request !== revealRequest.current) return;
      if (response.mfa_required) {
        setCodeItem(null);
        setStepUp({ item, code: '', attemptId: response.attempt_id, error: '' });
        return;
      }
      const result = reusable ? { ...response, view_token: cached.token, view_expires_at: cached.expiresAt } : response;
      grants.current[item.id] = { token: result.view_token, expiresAt: result.view_expires_at };
      setStepUp(null);
      activeViews.current[item.id] = result.view_token;
      setRevealed(prev => ({ ...prev, [item.id]: { code: result.code,
        nextAt: Date.now() + result.remaining_ms,
        token: result.view_token, expiresAt: result.view_expires_at } }));
      scheduleRefresh(item, result.view_token, result.view_expires_at, result.remaining_ms);
      if (result.outside_hours) setNotice('Consulta fuera de horario registrada.');
    } catch (e) {
      if (request !== revealRequest.current) return;
      delete grants.current[item.id];
      setCodeItem(null);
      if (e.status === 403 && e.attempt_id) setStepUp({ item, code: '', attemptId: e.attempt_id, error: e.message });
      else setError(e.message);
    }
  }
  const tabs = [{ id: 'codes', label: 'Códigos', icon: Key },
    ...(canHours ? [{ id: 'hours', label: 'Horarios', icon: Clock }] : []),
    ...(canAudit ? [{ id: 'audit', label: 'Auditoría', icon: Activity }] : []),
    ...(canAlerts ? [{ id: 'alerts', label: 'Alertas', icon: Bell }] : [])];
  const filtered = credentials.filter(c =>
    `${c.plataforma} ${c.cuenta} ${c.nombre} ${c.responsable_nombre || ''}`.toLowerCase().includes(query.toLowerCase()));
  const mine = credentials.filter(c => Number(c.responsable_id) === Number(usuario?.id) && c.estado === 'activo').length;
  const active = credentials.filter(c => c.estado === 'activo').length;
  return <main className="sc-root">
    <div className="sc-background" aria-hidden="true"><span/><span/><i className="bi bi-chat-dots sc-float-chat"/><i className="bi bi-chat-left-text sc-float-text"/></div>
    <header className="sc-page-top">
      <div><span className="sc-kicker">SEGURIDAD EMPRESARIAL</span><h1>Centro de Seguridad</h1>
        <p>Consulta los códigos del CRM y administra el acceso de tu equipo.</p></div>
      <div className="sc-top-actions"><button className="sc-ghost" type="button" onClick={load}><RefreshCw size={16}/> Actualizar</button>
        {canRegister && <button className="sc-primary" type="button"
          disabled={!canManage && mine >= (policy?.max_credentials ?? 1)}
          onClick={() => { setError(''); setModal(true); }}><Plus size={16}/> Registrar credencial</button>}</div>
    </header>
    <div className="sc-dashboard">
      <div className="sc-hero"><div className="sc-hero-main"><div className="sc-hero-mark"><Lock size={36}/></div><div>
        <div className="sc-hero-heading"><h2>Mis códigos 2FA</h2><span className="sc-count-pill">{credentials.length} {credentials.length === 1 ? 'credencial' : 'credenciales'}</span></div>
        <p>Códigos temporales para ingresar al CRM. Cada usuario registra su propia clave autorizada.</p>
      </div></div><i className="bi bi-shield-lock-fill sc-watermark" aria-hidden="true"/></div>
      <div className="sc-stat-row">
        <div className="sc-stat sc-stat-blue"><span><Key size={24}/></span><div><strong>{mine} / {policy?.max_credentials ?? 1}</strong><b>Mis credenciales</b><small>El administrador puede ampliar tu límite</small></div></div>
        <div className="sc-stat sc-stat-green"><span><Shield size={24}/></span><div><strong>{active}</strong><b>Disponibles</b><small>{canManage ? 'En esta instancia' : 'Asignadas a tu cuenta'}</small></div></div>
        <div className="sc-stat sc-stat-purple"><span><Users size={24}/></span><div><strong>{credentials.length}</strong><b>Cuentas visibles</b><small>{canManage ? 'En tu organización' : 'Con acceso asignado'}</small></div></div>
        <div className="sc-stat sc-stat-red"><span><Clock size={24}/></span><div><strong>30 s</strong><b>Vigencia del código</b><small>Se actualiza mientras lo visualizas</small></div></div>
      </div>
      <nav className="sc-tabs" aria-label="Secciones de seguridad">{tabs.map(t =>
        <button key={t.id} type="button" className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}><t.icon size={16}/>{t.label}</button>)}</nav>
      {error && <div className="sc-message sc-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar"><X size={14}/></button></div>}
      {notice && <div className="sc-message sc-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Cerrar"><X size={14}/></button></div>}
      {tab === 'codes' && <>
        <div className="sc-intro"><div><h3>Credenciales autorizadas</h3><p>Pulsa el ojo para consultar tu código. La visualización termina después de cinco minutos.</p></div>
          <span><Lock size={14}/> La clave nunca vuelve a mostrarse</span></div>
        <div className="sc-filter-bar"><label><i className="bi bi-search"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar plataforma, cuenta o usuario…"/></label>
          <span>{filtered.length} {filtered.length === 1 ? 'credencial' : 'credenciales'}</span></div>
        <section className="sc-panel sc-code-panel"><div className="sc-table-wrap"><table className="sc-table"><thead><tr>
          <th>Plataforma</th><th>Cuenta del CRM</th><th>Responsable</th><th>Estado</th><th>Acción</th>
        </tr></thead><tbody>{filtered.map(c => <tr key={c.id}>
            <td><span className="sc-platform"><Shield size={17}/>{c.plataforma}</span><small>{c.nombre}</small></td>
            <td><strong>{c.cuenta}</strong></td><td><span className="sc-responsible">
              <Avatar src={c.responsable_imagen} name={`${c.responsable_nombre || ''} ${c.responsable_apellido || ''}`}/>
              <span><strong>{c.responsable_nombre} {c.responsable_apellido}</strong><small>{Number(c.assigned_count) || 0} {Number(c.assigned_count) === 1 ? 'usuario con acceso' : 'usuarios con acceso'}</small></span>
            </span></td>
            <td><span className={`sc-status ${c.estado}`}>{c.estado}</span></td>
            <td><div className="sc-row-actions">
              <button className="sc-mini sc-mini-blue" disabled={c.estado !== 'activo' || !c.can_reveal}
                title={!c.can_reveal ? 'Asígnate acceso para consultar el código' : 'Consultar código'}
                onClick={() => void reveal(c)}><Eye size={15}/> Ver código</button>
              {canManage && <>
                <button className="sc-mini" onClick={() => void openDetail(c)}><Info size={15}/> Detalle</button>
                <button className="sc-mini" onClick={() => openEdit(c)}><Edit2 size={14}/> Editar</button>
                <button className="sc-mini sc-mini-green" disabled={c.estado !== 'activo'} onClick={() => void openAssign(c)}><UserPlus size={15}/> Asignar</button>
                <button className="sc-mini sc-mini-danger" disabled={busy} onClick={() => void deleteCredential(c)}><Trash2 size={14}/> Eliminar</button>
                <button className="sc-link" disabled={busy} onClick={() => act(() => api(`/credentials/${c.id}`, {
                  method: 'PATCH', body: JSON.stringify({ estado: c.estado === 'activo' ? 'suspendido' : 'activo' }) }), 'Estado actualizado')}>
                  {c.estado === 'activo' ? 'Suspender' : 'Activar'}</button>
              </>}
            </div></td>
          </tr>)}</tbody></table>
        {!filtered.length && <div className="sc-empty"><Lock size={30}/><strong>{query ? 'No hay resultados' : 'Aún no hay credenciales'}</strong>
          <p>{query ? 'Prueba otra búsqueda.' : 'Registra tu clave del CRM para consultar el código aquí.'}</p></div>}</div></section>
        <div className="sc-info"><Shield size={17}/><span>Cada persona tiene una credencial por defecto. Su límite se cambia en <strong>Gestión de usuarios → Editar usuario → Credenciales del CRM</strong>.</span></div>
      </>}
    {tab === 'hours' && policy && canHours && <section className="sc-grid"><div className="sc-panel"><div className="sc-panel-head"><div><h2>Horario laboral</h2><p>Fuera de horario se permite consultar con trazabilidad y alerta.</p></div></div><label className="sc-field">Zona horaria<input value={policy.timezone} onChange={e => setPolicy({ ...policy, timezone: e.target.value })}/></label><div className="sc-hours">{policy.hours.map((h,i) => <div className="sc-day" key={i}><label><input type="checkbox" checked={!!h.enabled} onChange={e => setPolicy({ ...policy, hours: policy.hours.map((x,j) => j === i ? { ...x, enabled: e.target.checked } : x) })}/>{days[i]}</label><input type="time" value={h.start_time} disabled={!h.enabled} onChange={e => setPolicy({ ...policy, hours: policy.hours.map((x,j) => j === i ? { ...x, start_time: e.target.value } : x) })}/><span>—</span><input type="time" value={h.end_time} disabled={!h.enabled} onChange={e => setPolicy({ ...policy, hours: policy.hours.map((x,j) => j === i ? { ...x, end_time: e.target.value } : x) })}/></div>)}</div><div className="sc-inline"><label>Consultas fuera de horario / 24 h<input type="number" min="0" max="100" value={policy.daily_offhours_limit} onChange={e => setPolicy({ ...policy, daily_offhours_limit: Number(e.target.value) })}/></label></div><label className="sc-check"><input type="checkbox" checked={policy.step_up_offhours} onChange={e => setPolicy({ ...policy, step_up_offhours: e.target.checked })}/> Solicitar MFA de {policy.brand || 'ChatVista'} fuera de horario cuando esté configurado</label><button className="sc-primary" disabled={busy} onClick={() => act(() => api('/policy', { method: 'PUT', body: JSON.stringify(policy) }), 'Horario guardado')}><Check size={16}/> Guardar horario</button></div>
      <div className="sc-panel"><h2>Excepciones del calendario</h2><p>Configura feriados o permisos de horario para una fecha.</p><div className="sc-form-grid"><label className="sc-field">Fecha<input type="date" value={exceptionForm.local_date} onChange={e => setExceptionForm({ ...exceptionForm, local_date: e.target.value })}/></label><label className="sc-field">Usuario (opcional)<select value={exceptionForm.usuario_id} onChange={e => setExceptionForm({ ...exceptionForm, usuario_id: e.target.value })}><option value="">Toda la instancia</option>{users.map(u => <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>)}</select></label><label className="sc-check sc-exception-toggle"><input type="checkbox" checked={exceptionForm.enabled} onChange={e => setExceptionForm({ ...exceptionForm, enabled: e.target.checked })}/><span>Habilitar acceso normal ese día</span></label>
        {exceptionForm.enabled && <div className="sc-exception-times"><label>Desde<input type="time" value={exceptionForm.start_time} onChange={e => setExceptionForm({ ...exceptionForm, start_time: e.target.value })}/></label><label>Hasta<input type="time" value={exceptionForm.end_time} onChange={e => setExceptionForm({ ...exceptionForm, end_time: e.target.value })}/></label></div>}
        <label className="sc-field sc-wide">Motivo<input value={exceptionForm.reason} onChange={e => setExceptionForm({ ...exceptionForm, reason: e.target.value })}/></label></div><button className="sc-primary" disabled={busy} onClick={() => act(async () => { await api('/exceptions', { method: 'POST', body: JSON.stringify(exceptionForm) }); setExceptions((await api('/exceptions')).exceptions); }, 'Excepción creada')}>Añadir excepción</button><ul className="sc-exceptions">{exceptions.map(x => <li key={x.id}>{x.local_date} · {x.reason} · {x.enabled ? `${x.start_time}–${x.end_time}` : 'No laborable'} <button className="sc-link" onClick={() => act(async () => { await api(`/exceptions/${x.id}`, { method: 'DELETE' }); setExceptions((await api('/exceptions')).exceptions); }, 'Excepción eliminada')}>Eliminar</button></li>)}</ul></div></section>}
    {tab === 'audit' && canAudit && <section className="sc-panel sc-audit-panel">
      <div className="sc-panel-head"><div><h2>Auditoría de códigos 2FA</h2><p>Consultas, intentos fuera de horario y cambios de credenciales.</p></div></div>
      <div className="sc-audit-filters">
        <select value={auditFilter.usuario_id} onChange={e => setAuditFilter({...auditFilter,usuario_id:e.target.value})}>
          <option value="">Todos los usuarios</option>{users.map(u => <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>)}
        </select>
        <input placeholder="Plataforma" value={auditFilter.plataforma} onChange={e => setAuditFilter({...auditFilter,plataforma:e.target.value})}/>
        <select aria-label="Filtrar acción" value={auditFilter.event_type} onChange={e => setAuditFilter({...auditFilter,event_type:e.target.value})}>
          <option value="">Todas las acciones</option><option value="CODE_REVEALED">Consultó código</option>
          <option value="CODE_ATTEMPT">Intentó consultar</option><option value="CREDENTIAL_CREATED">Agregó código</option>
          <option value="CREDENTIAL_UPDATED">Actualizó código</option><option value="CREDENTIAL_DELETED">Eliminó código</option>
        </select>
        <label>Desde<input type="date" value={auditFilter.from} onChange={e => setAuditFilter({...auditFilter,from:e.target.value})}/></label>
        <label>Hasta<input type="date" value={auditFilter.to} onChange={e => setAuditFilter({...auditFilter,to:e.target.value})}/></label>
        <select value={auditFilter.result} onChange={e => setAuditFilter({...auditFilter,result:e.target.value})}>
          <option value="">Todos los resultados</option><option value="success">Exitoso</option><option value="warning">Warning · fuera de horario</option>
        </select>
      </div>
      <div className="sc-table-wrap"><table className="sc-table sc-audit-table"><thead><tr>
        <th>Fecha y hora</th><th>Usuario</th><th>Categoría</th><th>Acción</th><th>Objetivo</th><th>Proyecto</th><th>Estado</th><th>Detalle</th>
      </tr></thead><tbody>{events.map(e => { const info=auditDetail(e.detail_json); return <tr key={e.id}>
        <td>{auditDate(e.created_at)}</td>
        <td><span className="sc-audit-user"><Avatar src={e.usuario_imagen} name={[e.usuario_nombre,e.usuario_apellido].filter(Boolean).join(' ')}/><span><strong>{[e.usuario_nombre,e.usuario_apellido].filter(Boolean).join(' ') || `Usuario ${e.usuario_id}`}</strong><small>{e.usuario_correo || '—'}</small></span></span></td>
        <td><span className="sc-audit-chip"><Shield size={12}/> Seguridad</span></td>
        <td><strong>{{ CODE_ATTEMPT: 'Intentó consultar fuera de horario', CREDENTIAL_CREATED: 'Agregó código 2FA', CREDENTIAL_UPDATED: 'Actualizó código 2FA', CREDENTIAL_DELETED: 'Eliminó código 2FA' }[e.event_type] || (e.outside_hours ? 'Consultó código fuera de horario' : 'Consultó código 2FA')}</strong></td>
        <td>{e.plataforma || info.platform || 'CRM'} · {e.cuenta || info.account || '—'}</td>
        <td>{e.proyecto_nombre || '—'}</td>
        <td><span className={`sc-audit-status ${e.outside_hours ? 'warning' : 'success'}`}>{e.outside_hours ? 'warning' : 'exitoso'}</span></td>
        <td><button className="sc-mini" onClick={() => setSelectedEvent(e)}><Eye size={14}/> Ver detalle</button></td>
      </tr>; })}</tbody></table>
      {!events.length && <div className="sc-empty"><Shield size={27}/><strong>Sin consultas en este período</strong></div>}</div>
    </section>}
    {tab === 'alerts' && canAlerts && alerts && <section className="sc-panel sc-narrow">
      <h2>Alertas de Telegram</h2><p>Los mensajes incluyen detalles del evento. Nunca se envían claves ni códigos 2FA.</p>
      <div className={`sc-telegram-status ${telegramStatus?.server_disabled || !telegramStatus?.telegram_enabled ? 'off' : utcDateMs(telegramStatus?.last_error_at) > utcDateMs(telegramStatus?.last_success_at) ? 'off' : telegramStatus?.last_success_at ? 'on' : 'waiting'}`} role="status">
        <span className="sc-telegram-dot"/>
        <span><strong>{telegramStatus?.server_disabled ? 'QuickChatBot desactivado en esta VPS' : !telegramStatus?.telegram_enabled ? 'QuickChatBot desconectado en ' + (telegramStatus?.brand || 'ChatVista') : !telegramStatus?.bot_configured || !telegramStatus?.chat_id ? 'QuickChatBot sin configurar' : utcDateMs(telegramStatus?.last_error_at) > utcDateMs(telegramStatus?.last_success_at) ? 'QuickChatBot sin conexión con Telegram' : telegramStatus?.last_success_at ? 'QuickChatBot en línea en ' + (telegramStatus?.brand || 'ChatVista') : 'Comprobando conexión con Telegram'}</strong><small>Estado de esta VPS. Al desactivar, deja de enviar avisos y descarta los pendientes.</small></span>
      </div>
      {telegramStatus?.pending_alerts > 0 && <p className="sc-telegram-unsaved" role="status">{telegramStatus.pending_alerts} aviso(s) pendiente(s) de entrega{telegramStatus.retrying_alerts > 0 ? `; ${telegramStatus.retrying_alerts} en reintento por un fallo de conexión` : ''}. La hora del mensaje indica cuándo ocurrió el intento.</p>}
      {telegramStatus?.undelivered_alerts > 0 && <p className="sc-warning-text" role="status">{telegramStatus.undelivered_alerts} aviso(s) sin entregar tras varios intentos. Revisa la conexión de la VPS con api.telegram.org y los registros de Node.</p>}
      {telegramStatus && !!alerts.telegram_enabled !== !!telegramStatus.telegram_enabled && <p className="sc-telegram-unsaved">El cambio de sincronización aún no se ha guardado. Pulsa «Guardar alertas» para aplicarlo.</p>}
      <div className="sc-telegram-setup">
        <strong>{alerts.chat_id ? 'Grupo privado configurado' : 'Vincular grupo privado'}</strong>
        {alerts.chat_id && <p>ID guardado: <b>{alerts.chat_id}</b>. La prueba de envío confirma si el bot puede publicar en este grupo.</p>}
        {telegramSetup?.configured ? <>
          {telegramSetup.command ? <><p>1. Añade <b>@{telegramSetup.username}</b> al grupo de Telegram y permítele enviar mensajes.</p>
          <p>2. Envía este comando dentro del grupo:</p>
          <div className="sc-telegram-command"><code>{telegramSetup.command}</code><button type="button" className="sc-mini" onClick={() => navigator.clipboard.writeText(telegramSetup.command).then(() => setNotice('Comando copiado')).catch(() => setError('No se pudo copiar el comando'))}><Copy size={14}/> Copiar</button></div></> : <p>No se pudo obtener el nombre del bot en esta consulta. La comprobación se repetirá cuando la API responda.</p>}
          <button type="button" className="sc-ghost" disabled={busy || !telegramSetup.command} onClick={() => void act(async () => {
            const found=await api('/alerts/discover',{method:'POST',body:'{}'});
            setTelegramGroup(found); setAlerts(prev => ({...prev,chat_id:found.chat_id}));
          },'Grupo encontrado. Guarda las alertas para vincularlo.')}><Search size={15}/> Buscar grupo</button>
          {telegramGroup && <p>Grupo encontrado: <b>{telegramGroup.title}</b> · {telegramGroup.chat_id}</p>}
        </> : <p>Primero configura <code>SECURITY_TELEGRAM_BOT_TOKEN</code> en el .env del backend de la VPS y reinicia Node. El token nunca se muestra aquí.</p>}
      </div>
      <div className="sc-form-grid sc-alerts-grid">
        <label className="sc-check sc-telegram-toggle"><input type="checkbox" checked={!!alerts.telegram_enabled} onChange={e => setAlerts({ ...alerts, telegram_enabled: e.target.checked })}/>Sincronización activa en esta VPS</label>
        <label className="sc-field">ID del grupo privado<input value={alerts.chat_id} placeholder="-100…" onChange={e => setAlerts({ ...alerts, chat_id: e.target.value })}/></label>
        <label className="sc-field">Hora del resumen diario<input type="time" value={alerts.daily_digest_time} onChange={e => setAlerts({ ...alerts, daily_digest_time: e.target.value })}/></label>
        {[['alert_offhours','Intentos y consultas 2FA fuera de horario'],['alert_new_device','Primer dispositivo de confianza'],['alert_multiple_devices','Más de un dispositivo de confianza']].map(([key,label]) =>
          <label className="sc-check" key={key}><input type="checkbox" checked={alerts[key]} onChange={e => setAlerts({ ...alerts, [key]: e.target.checked })}/>{label}</label>)}
      </div>
      <div className="sc-telegram-actions">
        <button className="sc-primary" disabled={busy} onClick={() => act(async () => { await api('/alerts', { method: 'PUT', body: JSON.stringify(alerts) }); setTelegramStatus(await api('/alerts')); }, 'Configuración de alertas guardada')}>Guardar alertas</button>
        <button className="sc-ghost" disabled={busy || telegramStatus?.server_disabled || !alerts.telegram_enabled || !alerts.chat_id || !telegramSetup?.configured} onClick={async () => {
          setBusy(true); setError(''); setNotice('');
          try { const sent = await api('/alerts/test',{method:'POST',body:'{}'});
            setNotice(`Telegram confirmó el mensaje ${sent.message_id} en el grupo ${sent.group}.`); }
          catch (e) { setError(e.message); }
          finally { setBusy(false); }
        }}><Bell size={15}/> Enviar prueba</button>
      </div>
    </section>}
    </div>
    {selectedEvent && <div className="sc-overlay" onMouseDown={e => { if(e.target===e.currentTarget) setSelectedEvent(null); }}>
      <section className="sc-modal sc-audit-detail" role="dialog" aria-modal="true" aria-label="Detalle de actividad 2FA">
        <div className="sc-modal-head"><div><span className="sc-eyebrow">AUDITORÍA 2FA</span><h2>Detalle de la actividad</h2></div>
          <button className="sc-icon" onClick={() => setSelectedEvent(null)} aria-label="Cerrar"><X size={19}/></button></div>
        <div className="sc-audit-facts">
          <div><small>Fecha y hora</small><strong>{auditDate(selectedEvent.created_at)}</strong></div>
          <div><small>Usuario</small><span className="sc-audit-user sc-audit-detail-user"><Avatar src={selectedEvent.usuario_imagen} name={[selectedEvent.usuario_nombre,selectedEvent.usuario_apellido].filter(Boolean).join(' ')}/><span><strong>{[selectedEvent.usuario_nombre,selectedEvent.usuario_apellido].filter(Boolean).join(' ') || `Usuario ${selectedEvent.usuario_id}`}</strong><small>{selectedEvent.usuario_correo}</small></span></span></div>
          <div><small>Plataforma y cuenta</small><strong>{selectedEvent.plataforma || auditDetail(selectedEvent.detail_json).platform || 'CRM'} · {selectedEvent.cuenta || auditDetail(selectedEvent.detail_json).account || '—'}</strong></div>
          <div><small>Estado</small><strong className={selectedEvent.outside_hours ? 'sc-warning-text' : 'sc-success-text'}>{selectedEvent.event_type === 'CODE_ATTEMPT' ? 'warning · intento fuera de horario; código no revelado en este evento' : selectedEvent.outside_hours ? 'warning · código consultado fuera de horario' : 'exitoso'}</strong></div>
          <div><small>IP pública de conexión</small><strong>{selectedEvent.ip && !/^(127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(selectedEvent.ip) ? selectedEvent.ip : 'No disponible: revisar proxy'}</strong><small>IP local reportada por el navegador: {auditDetail(selectedEvent.detail_json).clientDevice?.localIp || 'No disponible'}</small></div>
          <div><small>Navegador y sistema</small><strong>{deviceDescription(selectedEvent.user_agent, auditDetail(selectedEvent.detail_json))}</strong><small>Datos reportados por el navegador · {selectedEvent.user_agent || 'Sin User-Agent'}</small></div>
          <div><small>Proyecto</small><strong>{selectedEvent.proyecto_nombre || '—'}</strong></div>
          <div><small>Sesión</small><strong>{selectedEvent.session_id || '—'}</strong></div>
        </div>
        <div className="sc-modal-foot"><button className="sc-ghost" onClick={() => setSelectedEvent(null)}>Cerrar</button></div>
      </section></div>}
    {codeItem && <div className="sc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeCode(); }}>
      <section className="sc-code-dialog" role="dialog" aria-modal="true" aria-label={`Código 2FA de ${codeItem.cuenta}`}>
        <div className="sc-dialog-grip"/><button className="sc-dialog-close" onClick={closeCode} aria-label="Cerrar"><X size={19}/></button>
        <span className="sc-dialog-kicker">ACCESO AL CRM</span><h2>{codeItem.plataforma} · {codeItem.cuenta}</h2>
        <p>Código temporal de seis dígitos</p>
        <div className="sc-countdown"><Clock size={15}/> Cambia en <strong>{revealed[codeItem.id]
          ? `${Math.max(0, Math.ceil((revealed[codeItem.id].nextAt - clock) / 1000))} s` : '— s'}</strong>
          <span className="sc-countdown-track"><i style={{width:revealed[codeItem.id]
            ? `${Math.max(0, (revealed[codeItem.id].nextAt-clock)/300)}%` : '0%'}}/></span></div>
        {revealed[codeItem.id] ?
          <div className={`sc-digit-deck ${refreshing || revealed[codeItem.id].nextAt - clock <= 1700 ? 'is-closing' : 'is-opening'}`} aria-label="Código de seis dígitos">
            {revealed[codeItem.id].code.split('').map((digit, index) => <span key={index}
              style={{ '--fan': `${(index - 2.5) * 34}px`, '--final': `${(index - 2.5) * 62}px`,
                '--mobile-final': `${(index - 2.5) * 45}px`,
                '--tilt': `${(index - 2.5) * 8}deg`, zIndex: 6 - index }}><b>{digit}</b></span>)}
          </div>
          : <div className="sc-deck-loading"><span/></div>}
          <div className="sc-dialog-actions">
            <button className="sc-ghost" disabled={!revealed[codeItem.id] || refreshing} onClick={async () => {
              const view = revealed[codeItem.id];
              setRefreshing(true); setRefreshMessage('');
              clearTimeout(timers.current[codeItem.id]);
              try {
                await new Promise(resolve => setTimeout(resolve, 420));
                if (activeViews.current[codeItem.id] !== view.token) return;
                const next = await api(`/credentials/${codeItem.id}/current`, {method:'POST',body:JSON.stringify({view_token:view.token})});
                if (activeViews.current[codeItem.id] !== view.token) return;
                setRefreshMessage(next.code === view.code ? 'Este código sigue vigente hasta el próximo intervalo.' : 'Código actualizado.');
                setRevealed(prev => ({...prev,[codeItem.id]: {...view,code:next.code,nextAt:Date.now()+next.remaining_ms}}));
                scheduleRefresh(codeItem,view.token,view.expiresAt,next.remaining_ms);
                setRefreshing(false);
              } catch (e) { closeCode(); setError(e.message); }
            }}><RefreshCw size={15}/> Recargar</button>
            <button className={`sc-primary sc-copy-button ${copied ? 'is-copied' : ''}`} disabled={!revealed[codeItem.id] || refreshing || clock >= revealed[codeItem.id].nextAt} onClick={async () => {
              try { await navigator.clipboard.writeText(revealed[codeItem.id].code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
              catch { setError('No se pudo copiar. Selecciona el código manualmente.'); }
            }}><span className="sc-copy-icon">{copied ? <Check size={15}/> : <Copy size={15}/>}</span><span>{copied ? '¡Copiado!' : 'Copiar código'}</span></button>
          </div>
          <small className="sc-refresh-message" role="status">{refreshMessage}</small>
          <small className="sc-dialog-note"><Lock size={13}/> La visualización se cierra tras cinco minutos o al salir de la pestaña.</small>
      </section></div>}
    {detailItem && <div className="sc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDetailItem(null); }}>
      <section className="sc-modal sc-access-dialog" role="dialog" aria-modal="true" aria-label="Detalle de accesos">
        <div className="sc-modal-head"><div><span className="sc-eyebrow">CREDENCIAL AUTORIZADA</span><h2>Detalle de accesos</h2></div>
          <button className="sc-icon" onClick={() => setDetailItem(null)} aria-label="Cerrar"><X size={20}/></button></div>
        <p>{detailItem.plataforma} · {detailItem.cuenta}</p>
        <h3><Users size={17}/> Personas con acceso {accessInfo && `(${accessInfo.members.length})`}</h3>
        {!accessInfo && <p>Cargando accesos…</p>}
        {accessInfo?.members.map(member => <div className="sc-member" key={member.id}>
          <Avatar src={member.url_imagen} name={`${member.nombre || ''} ${member.apellido || ''}`}/>
          <div><strong>{member.nombre} {member.apellido} <em>({member.rol_nombre || 'Sin rol'})</em></strong><small>{member.correo}{Number(member.id) === Number(accessInfo.owner_id) ? ' · Responsable' : ''}</small></div>
          {Number(member.id) !== Number(accessInfo.owner_id) && <button className="sc-link" disabled={busy} onClick={() => void act(async () => {
            await api(`/credentials/${detailItem.id}/access/${member.id}`,{method:'PUT',body:JSON.stringify({enabled:false})});
            setAccessInfo(await api(`/credentials/${detailItem.id}/access`));
          },'Acceso retirado')}>Retirar</button>}
        </div>)}
        <div className="sc-modal-foot"><button className="sc-ghost" onClick={() => setDetailItem(null)}>Cerrar</button>
          <button className="sc-primary" onClick={() => { const item=detailItem; setDetailItem(null); void openAssign(item); }}><UserPlus size={16}/> Asignar usuario</button></div>
      </section></div>}
    {assignItem && <div className="sc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setAssignItem(null); }}>
      <section className="sc-modal sc-assign-dialog" role="dialog" aria-modal="true" aria-label="Añadir miembros">
        <div className="sc-modal-head"><div className="sc-assign-heading"><span className="sc-hero-mark"><UserPlus size={22}/></span><div><h2>Añadir miembro</h2><p>Selecciona usuarios para acceder a {assignItem.cuenta}</p></div></div>
          <button className="sc-icon" onClick={() => setAssignItem(null)} aria-label="Cerrar"><X size={20}/></button></div>
        <label className="sc-member-search"><Search size={17}/><input autoFocus placeholder="Buscar un nombre o correo" value={memberSearch} onChange={e => setMemberSearch(e.target.value)}/></label>
        <div className="sc-member-list"><strong>Usuarios disponibles</strong>
          {users.filter(u => !accessInfo?.members.some(m => Number(m.id) === Number(u.id)) &&
            `${u.nombre} ${u.apellido} ${u.correo}`.toLowerCase().includes(memberSearch.toLowerCase())).map(u =>
            <label className="sc-member" key={u.id}><input type="checkbox" checked={selectedMembers.includes(u.id)}
              onChange={e => setSelectedMembers(prev => e.target.checked ? [...prev,u.id] : prev.filter(id => id !== u.id))}/>
              <Avatar src={u.url_imagen} name={`${u.nombre || ''} ${u.apellido || ''}`}/>
              <span><strong>{u.nombre} {u.apellido} <em>({u.rol_nombre || 'Sin rol'})</em></strong><small>{u.correo}</small></span>
            </label>)}
          {accessInfo && !users.some(u => !accessInfo.members.some(m => Number(m.id) === Number(u.id)) &&
            `${u.nombre} ${u.apellido} ${u.correo}`.toLowerCase().includes(memberSearch.toLowerCase())) &&
            <p>No hay usuarios disponibles para esta búsqueda.</p>}
        </div>
        <div className="sc-selection-count"><Info size={14}/> El responsable siempre conserva acceso. <strong>{selectedMembers.length} seleccionados</strong></div>
        <div className="sc-modal-foot"><button className="sc-ghost" onClick={() => setAssignItem(null)}>Cancelar</button>
          <button className="sc-primary" disabled={!accessInfo || !selectedMembers.length || busy} onClick={() => void saveMembers()}><UserPlus size={16}/> Añadir seleccionados</button></div>
      </section></div>}
    {editItem && <div className="sc-overlay" onMouseDown={e => { if(e.target === e.currentTarget) setEditItem(null); }}>
      <form className="sc-modal sc-register-modal" onSubmit={updateCredential}>
        <div className="sc-modal-head"><div><span className="sc-eyebrow">CREDENCIAL AUTORIZADA</span><h2>Editar código 2FA</h2></div>
          <button type="button" className="sc-icon" onClick={() => setEditItem(null)} aria-label="Cerrar"><X size={20}/></button></div>
        <p className="sc-hint">Puedes cambiar los datos y el responsable. Deja la clave vacía para conservar el secreto actual.</p>
        {error && <div className="sc-message sc-error" role="alert">{error}</div>}
        <div className="sc-form-grid">
          <label className="sc-field">Plataforma<input required maxLength="100" value={editForm.plataforma} onChange={e => setEditForm({...editForm,plataforma:e.target.value})}/></label>
          <label className="sc-field">Cuenta o usuario<input required maxLength="190" value={editForm.cuenta} onChange={e => setEditForm({...editForm,cuenta:e.target.value})}/></label>
          <label className="sc-field sc-wide">Nombre descriptivo<input required maxLength="190" value={editForm.nombre} onChange={e => setEditForm({...editForm,nombre:e.target.value})}/></label>
          <label className="sc-field sc-wide">Nueva clave manual o URI TOTP (opcional)<input autoComplete="off" spellCheck="false" value={editForm.clave} onChange={e => setEditForm({...editForm,clave:e.target.value})} placeholder="Dejar vacía para conservar la clave"/></label>
        </div>
        <div className="sc-owner-section">
          <div className="sc-owner-title"><strong>Responsable</strong><small>Selecciona una persona</small></div>
          <label className="sc-member-search"><Search size={16}/><input value={editOwnerSearch} onChange={e => setEditOwnerSearch(e.target.value)} placeholder="Buscar por nombre o correo…"/></label>
          <div className="sc-owner-list" role="group" aria-label="Seleccionar responsable">
            {users.filter(u => `${u.nombre} ${u.apellido} ${u.correo}`.toLowerCase().includes(editOwnerSearch.toLowerCase())).map(u =>
              <button type="button" key={u.id} className={Number(editForm.responsable_id) === Number(u.id) ? 'is-selected' : ''}
                aria-pressed={Number(editForm.responsable_id) === Number(u.id)}
                onClick={() => setEditForm({...editForm,responsable_id:String(u.id)})}>
                <span className="sc-owner-check">{Number(editForm.responsable_id) === Number(u.id) && <Check size={12}/>}</span>
                <Avatar src={u.url_imagen} name={`${u.nombre || ''} ${u.apellido || ''}`}/>
                <span className="sc-owner-info"><strong>{u.nombre} {u.apellido}</strong><small>{u.correo}</small></span>
                <em>{u.rol_nombre || 'Usuario'}</em>
              </button>)}
            {!users.some(u => `${u.nombre} ${u.apellido} ${u.correo}`.toLowerCase().includes(editOwnerSearch.toLowerCase())) && <p>Sin resultados</p>}
          </div>
        </div>
        <div className="sc-modal-foot"><button type="button" className="sc-ghost" onClick={() => setEditItem(null)}>Cancelar</button><button className="sc-primary" disabled={busy} type="submit">Guardar cambios</button></div>
      </form></div>}
    {modal && <div className="sc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false); }}>
      <form className="sc-modal sc-register-modal" onSubmit={register}>
        <div className="sc-modal-head"><div><span className="sc-eyebrow">NUEVA CREDENCIAL</span><h2>Registrar código 2FA</h2></div><button type="button" className="sc-icon" onClick={() => setModal(false)} aria-label="Cerrar"><X size={20}/></button></div>
        <p className="sc-hint">Ingresa la clave manual que entrega la plataforma, como en la pantalla de Google Authenticator. También puedes pegar una URI otpauth compatible. Úsala solo si tienes autorización del CRM.</p>
        {error && <div className="sc-message sc-error" role="alert">{error}</div>}
        <div className="sc-form-grid">
          <label className="sc-field">Plataforma<input required maxLength="100" value={form.plataforma} onChange={e => setForm({ ...form, plataforma: e.target.value })}/></label>
          <label className="sc-field">Cuenta o usuario<input required maxLength="190" value={form.cuenta} onChange={e => setForm({ ...form, cuenta: e.target.value })}/></label>
          <label className="sc-field sc-wide">Nombre descriptivo<input required maxLength="190" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}/></label>
          <label className="sc-field sc-wide">Clave manual o URI TOTP<input required autoComplete="off" spellCheck="false" value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value })} placeholder="Clave Base32 proporcionada por la plataforma"/></label>
        </div>
        {canManage && <div className="sc-owner-section">
          <div className="sc-owner-title"><strong>Responsable</strong><small>Selecciona una persona</small></div>
          <label className="sc-member-search"><Search size={16}/><input value={ownerSearch} onChange={e => setOwnerSearch(e.target.value)} placeholder="Buscar por nombre o correo…"/></label>
          <div className="sc-owner-list" role="group" aria-label="Seleccionar responsable">
            {(users.length ? users : [usuario]).filter(u => `${u.nombre} ${u.apellido} ${u.correo}`.toLowerCase().includes(ownerSearch.toLowerCase())).map(u =>
              <button type="button" key={u.id} className={Number(form.responsable_id || usuario.id) === Number(u.id) ? 'is-selected' : ''}
                aria-pressed={Number(form.responsable_id || usuario.id) === Number(u.id)}
                onClick={() => setForm({...form,responsable_id:String(u.id)})}>
                <span className="sc-owner-check">{Number(form.responsable_id || usuario.id) === Number(u.id) && <Check size={12}/>}</span>
                <Avatar src={u.url_imagen} name={`${u.nombre || ''} ${u.apellido || ''}`}/>
                <span className="sc-owner-info"><strong>{u.nombre} {u.apellido}</strong><small>{u.correo}</small></span>
                <em>{u.rol_nombre || 'Usuario'}</em>
              </button>)}
            {!(users.length ? users : [usuario]).some(u => `${u.nombre} ${u.apellido} ${u.correo}`.toLowerCase().includes(ownerSearch.toLowerCase())) && <p>Sin resultados</p>}
          </div>
        </div>}
        <div className="sc-modal-foot"><button type="button" className="sc-ghost" onClick={() => setModal(false)}>Cancelar</button><button className="sc-primary" disabled={busy} type="submit">Guardar de forma segura</button></div>
      </form>
    </div>}
    {stepUp && <div className="sc-overlay"><form className="sc-modal sc-step" onSubmit={e => { e.preventDefault(); if (stepUp.submitting) return; setStepUp(prev => ({ ...prev, submitting: true, error: '' })); void reveal(stepUp.item, stepUp.code, stepUp.attemptId); }}><div className="sc-modal-head"><h2>Confirmar identidad</h2><button type="button" className="sc-icon" onClick={closeStepUp} aria-label="Cerrar"><X size={20}/></button></div><p>Esta consulta es fuera de horario. Introduce el código de tu MFA de {policy?.brand || 'ChatVista'}.</p><label className="sc-field">Código de seis dígitos<input inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoFocus value={stepUp.code} onChange={e => setStepUp({ ...stepUp, code: e.target.value.replace(/\D/g,'').slice(0,6) })}/></label>{stepUp.error && <p className="sc-warning-text" role="alert">{stepUp.error}</p>}<div className="sc-modal-foot"><button type="button" className="sc-ghost" onClick={closeStepUp}>Cancelar</button><button type="submit" className="sc-primary" disabled={stepUp.submitting || stepUp.code.length !== 6}>{stepUp.submitting ? 'Verificando…' : 'Consultar código'}</button></div></form></div>}
  </main>;
}
