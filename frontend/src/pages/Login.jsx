import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logDev } from "../utils/logger";
import axios from 'axios';
import '../css/Login.css';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    const cleanEmail = email.trim();

    if (!cleanEmail.includes('@')) {
      setError('Email inválido');
      return;
    }

    try {
      const res = await axios.post('/api/usuario/login', {
        correo: cleanEmail,
        contrasena: password,
      });

      logDev('Login exitoso', { usuarioId: res.data?.usuario?.id });
      setError('');
      // ✅ Guardar usuario en localStorage
      localStorage.setItem('usuario', JSON.stringify(res.data.usuario));

      // Redirigir a /mensajes
      navigate('/mensajes');
    } catch (err) {
      if (err.response) {
        setError(err.response.data.error); // Mensaje del servidor
      } else {
        setError('Error de conexión');
      }
    }
  };

  return (
    <main className="quick-login">
      <div className="quick-login-bg" aria-hidden="true">
        <div className="quick-bg-orb quick-bg-orb-1" />
        <div className="quick-bg-orb quick-bg-orb-2" />
        <div className="quick-bg-orb quick-bg-orb-3" />

        <div className="quick-particles">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} className={`quick-particle quick-particle-${index + 1}`} />
          ))}
        </div>

        <div className="quick-speed-lines">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <svg className="quick-chat-bubble quick-chat-bubble-lg" viewBox="0 0 240 190" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M40 22H183C205.091 22 223 39.9086 223 62V109C223 131.091 205.091 149 183 149H142L144 181L111 149H40C17.9086 149 0 131.091 0 109V62C0 39.9086 17.9086 22 40 22Z" stroke="currentColor" strokeWidth="8" />
          <circle cx="75" cy="86" r="13" fill="currentColor" />
          <circle cx="118" cy="86" r="13" fill="currentColor" />
          <circle cx="161" cy="86" r="13" fill="currentColor" />
        </svg>

        <svg className="quick-chat-bubble quick-chat-bubble-sm" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M24 12H126C139.255 12 150 22.7452 150 36V66C150 79.2548 139.255 90 126 90H93L95 112L72 90H24C10.7452 90 0 79.2548 0 66V36C0 22.7452 10.7452 12 24 12Z" stroke="currentColor" strokeWidth="6" />
          <circle cx="52" cy="51" r="8" fill="currentColor" />
          <circle cx="80" cy="51" r="8" fill="currentColor" />
          <circle cx="108" cy="51" r="8" fill="currentColor" />
        </svg>

        <svg className="quick-chat-bubble quick-chat-bubble-right" viewBox="0 0 170 130" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M25 16H135C148.807 16 160 27.1929 160 41V73C160 86.8071 148.807 98 135 98H96L92 122L70 98H25C11.1929 98 0 86.8071 0 73V41C0 27.1929 11.1929 16 25 16Z" stroke="currentColor" strokeWidth="5" />
          <circle cx="57" cy="57" r="8" fill="currentColor" />
          <circle cx="85" cy="57" r="8" fill="currentColor" />
          <circle cx="113" cy="57" r="8" fill="currentColor" />
        </svg>

        <svg className="quick-user-bubble" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M28 16H73C88.464 16 101 28.536 101 44V72C101 77.612 99.35 82.839 96.507 87.222L105 107L83.847 97.224C80.519 98.365 76.949 99 73 99H28C12.536 99 0 86.464 0 71V44C0 28.536 12.536 16 28 16Z" stroke="currentColor" strokeWidth="5" />
          <circle cx="51" cy="47" r="14" fill="currentColor" />
          <path d="M26 82C31.4 68.7 40.6 62 51 62C61.4 62 70.6 68.7 76 82" fill="currentColor" opacity="0.8" />
        </svg>

        <svg className="quick-heart-bubble" viewBox="0 0 104 104" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M23 10H65C80.464 10 93 22.536 93 38V58C93 73.464 80.464 86 65 86H51L32 100L34 86H23C7.536 86 -5 73.464 -5 58V38C-5 22.536 7.536 10 23 10Z" stroke="currentColor" strokeWidth="5" />
          <path d="M44 60C29 50 28 36 37 32C43 29 48 33 50 37C52 33 57 29 63 32C72 36 71 50 56 60L50 64L44 60Z" fill="currentColor" />
        </svg>

        <svg className="quick-plane" viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path className="quick-plane-dash" d="M2 118C52 99 77 84 114 65" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="16 14" />
          <path d="M94 58L222 12L171 145L145 91L94 58Z" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
          <path d="M145 91L222 12L126 76" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M145 91L112 128L126 76" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <svg className="quick-lightning quick-lightning-left" viewBox="0 0 760 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 79C58 93 107 99 152 85C185 74 201 53 239 62C280 72 298 114 346 104C391 95 404 50 449 55C497 61 520 118 574 105C625 93 634 48 682 48C708 48 731 62 760 77" stroke="url(#qc-lightning-left)" strokeWidth="5" strokeLinecap="round" />
          <path d="M42 101L80 93L68 121L113 104" stroke="url(#qc-lightning-left)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <defs>
            <linearGradient id="qc-lightning-left" x1="0" y1="80" x2="760" y2="80" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="0.2" stopColor="#FFFFFF" />
              <stop offset="0.55" stopColor="#19D8FF" />
              <stop offset="1" stopColor="#8B5CFF" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        <svg className="quick-lightning quick-lightning-right" viewBox="0 0 760 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 103C58 84 111 79 154 91C201 104 214 133 261 121C302 110 321 64 371 71C416 77 433 116 478 111C528 106 552 62 605 67C652 71 688 95 760 80" stroke="url(#qc-lightning-right)" strokeWidth="5" strokeLinecap="round" />
          <path d="M618 93L646 78L638 111L687 84" stroke="url(#qc-lightning-right)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <defs>
            <linearGradient id="qc-lightning-right" x1="0" y1="90" x2="760" y2="90" gradientUnits="userSpaceOnUse">
              <stop stopColor="#25D8FF" stopOpacity="0" />
              <stop offset="0.3" stopColor="#25D8FF" />
              <stop offset="0.62" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#A855F7" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        <svg className="quick-network quick-network-left" viewBox="0 0 560 300" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 214L75 166L133 224L212 121L285 205L370 152L498 248" stroke="currentColor" strokeOpacity="0.38" strokeWidth="2" />
          <path d="M75 166L212 121L370 152M133 224L285 205L498 248M75 166L133 224L285 205" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.6" />
          {[12, 75, 133, 212, 285, 370, 498].map((x, index) => (
            <circle key={x} cx={x} cy={[214, 166, 224, 121, 205, 152, 248][index]} r={index === 3 ? 8 : 6} fill="currentColor" />
          ))}
        </svg>

        <svg className="quick-network quick-network-right" viewBox="0 0 560 300" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M35 238L111 186L195 220L258 132L333 182L423 97L524 154" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
          <path d="M111 186L258 132L423 97M195 220L333 182L524 154M35 238L195 220L333 182" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.6" />
          {[35, 111, 195, 258, 333, 423, 524].map((x, index) => (
            <circle key={x} cx={x} cy={[238, 186, 220, 132, 182, 97, 154][index]} r={index === 5 ? 8 : 6} fill="currentColor" />
          ))}
        </svg>
      </div>

      <section className="quick-login-card" aria-labelledby="quick-login-title">
        <div className="quick-brand">
          <span className="quick-brand-logo" aria-hidden="true">
            <img src="/logo-quick-chat.png" alt="" />
          </span>
          <span className="quick-brand-name">
            Quick <strong>Chat</strong>
          </span>
        </div>

        <header className="quick-login-header">
          <h1 id="quick-login-title" className="quick-title">Iniciar sesión</h1>
          <p className="quick-subtitle">Bienvenido de vuelta, nos alegra verte</p>
          <span className="quick-title-line" />
        </header>

        {error && (
          <p className="quick-error" role="alert">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            {error}
          </p>
        )}

        <form onSubmit={handleLogin} className="quick-login-form">
          <div className="quick-input-group">
            <label htmlFor="email-input" className="quick-input-icon" aria-label="Correo electrónico">
              <i className="fa-regular fa-envelope" aria-hidden="true" />
            </label>
            <input
              id="email-input"
              type="email"
              placeholder="Correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="quick-input-group quick-input-password">
            <label htmlFor="password-input" className="quick-input-icon" aria-label="Contraseña">
              <i className="fa-solid fa-lock" aria-hidden="true" />
            </label>
            <input
              id="password-input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="quick-password-toggle"
              onClick={() => setShowPassword((currentValue) => !currentValue)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPassword}
            >
              <i className={showPassword ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye'} aria-hidden="true" />
            </button>
          </div>

          <button type="submit" className="quick-login-button">
            <i className="fa-solid fa-bolt" aria-hidden="true" />
            <span>Ingresar</span>
          </button>
        </form>

        <a
          href="#recuperar-contrasena"
          className="quick-forgot-link"
          onClick={(event) => event.preventDefault()}
        >
          ¿Olvidaste tu contraseña?
        </a>

        <div className="quick-secure-line" aria-hidden="true">
          <span />
          <i className="fa-solid fa-shield-halved" />
          <span />
        </div>

        <p className="quick-secure-text">Conecta rápido y seguro</p>
      </section>
    </main>
  );
}

export default Login;
