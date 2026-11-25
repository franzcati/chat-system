import { useEffect, useState } from 'react';
import { FileText, Image, Video } from 'lucide-react';
import '../css/EstadoCita.css';
import { statusFont } from '../utils/estadoPresentacion';

export default function EstadoCita({ reference }) {
  const { id, snapshot } = reference;
  const [live, setLive] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (snapshot) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/estados/${id}/referencia`, {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted) setLive(data);
        }
      } catch { /* La cita guardada permanece disponible incluso sin conexión. */ }
    }
    load();
    return () => controller.abort();
  }, [id, snapshot]);
  const { author, medium, caption, excerpt, fuente } = snapshot ? reference : live || reference;
  const Icon = medium === 'Video' ? Video : ['Foto', 'GIF'].includes(medium) ? Image : FileText;
  const path = `/api/estados/${id}/media`;
  return <blockquote className="qc-status-quote">
    <span className="qc-status-quote-copy">
      <strong>{author ? author + ' · Estados' : 'Estados'}</strong>
      <span><Icon size={14} aria-hidden="true"/>{medium || (excerpt ? 'Estado' : 'Estado no disponible')}</span>
      {excerpt && <small style={{ fontFamily: statusFont(fuente) }}>{excerpt}</small>}{caption && caption !== excerpt && <small>{caption}</small>}
    </span>
    {!failed && (medium === 'Video' ?
      <video aria-label="Miniatura del video" src={path + '#t=0.001'} muted playsInline preload="metadata" onError={() => setFailed(true)}/> :
      ['Foto','GIF'].includes(medium) && <img src={path} alt="" loading="lazy" onError={() => setFailed(true)}/>)}
  </blockquote>;
}
