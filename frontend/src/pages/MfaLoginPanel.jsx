import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

function MfaLoginPanel({
  mode,
  challenge,
  setupData,
  methods = { totp: false, email: false, recovery: false },
  accountFallback,
  onComplete,
  onCancel,
  onError,
}) {
  const [loading, setLoading] = useState(false);

  const [setupChoice, setSetupChoice] = useState('');
  const [totpSetupData, setTotpSetupData] = useState(setupData || null);
  const [totpSetupLoading, setTotpSetupLoading] = useState(false);

  const [code, setCode] = useState('');
  const [method, setMethod] = useState(
    methods?.totp ? 'totp' : methods?.email ? 'email' : 'totp'
  );

  const [emailStatus, setEmailStatus] = useState({
    loading: mode === 'verify' && Boolean(methods?.email),
    available: Boolean(methods?.email),
    maskedEmail: '',
    cooldownSeconds: 60,
  });

  const [emailInput, setEmailInput] = useState('');
  const [emailRequest, setEmailRequest] = useState(null);
  const [emailCode, setEmailCode] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const cleanCode = useMemo(
    () => String(code || '').replace(/\D/g, '').slice(0, 6),
    [code]
  );

  const cleanEmailCode = useMemo(
    () => String(emailCode || '').replace(/\D/g, '').slice(0, 6),
    [emailCode]
  );

  useEffect(() => {
    if (mode !== 'verify') return;
    if (!methods?.totp && methods?.email) setMethod('email');
    if (methods?.totp && !methods?.email) setMethod('totp');
  }, [mode, methods]);

  useEffect(() => {
    if (mode !== 'verify' || !challenge || !methods?.email) {
      setEmailStatus((current) => ({
        ...current,
        loading: false,
        available: Boolean(methods?.email),
      }));
      return undefined;
    }

    let cancelled = false;

    const loadStatus = async () => {
      try {
        const res = await axios.post('/api/mfa/email/login/status', {
          challenge,
        });

        if (cancelled) return;

        setEmailStatus({
          loading: false,
          available: Boolean(res.data?.email_available),
          maskedEmail: res.data?.masked_email || '',
          cooldownSeconds: Number(res.data?.cooldown_seconds || 60),
        });
      } catch {
        if (cancelled) return;

        setEmailStatus({
          loading: false,
          available: false,
          maskedEmail: '',
          cooldownSeconds: 60,
        });
      }
    };

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [challenge, mode, methods]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;

    const timer = window.setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldown]);

  const startTotpSetup = async () => {
    setTotpSetupLoading(true);
    onError?.('');

    try {
      const res = await axios.post('/api/mfa/setup/start', {
        challenge,
      });

      setTotpSetupData(res.data);
      setSetupChoice('totp');
      setCode('');
    } catch (error) {
      onError?.(
        error.response?.data?.error
        || 'No se pudo preparar Google Authenticator.'
      );
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const submitTotp = async (event) => {
    event.preventDefault();

    if (cleanCode.length !== 6) {
      onError?.('Ingresa los 6 dígitos de Google Authenticator.');
      return;
    }

    setLoading(true);
    onError?.('');

    try {
      const endpoint =
        mode === 'setup'
          ? '/api/mfa/setup/verify'
          : '/api/mfa/verify-login';

      const res = await axios.post(
        endpoint,
        {
          challenge,
          code: cleanCode,
        },
        {
          withCredentials: true,
        }
      );

      onComplete?.(res.data?.usuario);
    } catch (error) {
      onError?.(
        error.response?.data?.error
        || (
          mode === 'setup'
            ? 'No se pudo activar Google Authenticator.'
            : 'Código de autenticación incorrecto.'
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const requestEmailCode = async ({ enrollment = false } = {}) => {
    const setupEnrollment = mode === 'setup' || enrollment;

    if (setupEnrollment) {
      const email = String(emailInput || '').trim();
      if (!email || !email.includes('@')) {
        onError?.('Ingresa un correo real válido.');
        return;
      }
    } else if (!emailStatus.available) {
      return;
    }

    setEmailLoading(true);
    onError?.('');

    try {
      const endpoint = setupEnrollment
        ? '/api/mfa/email/enroll/request'
        : '/api/mfa/email/login/request';

      const payload = setupEnrollment
        ? {
            challenge,
            email: emailInput.trim(),
          }
        : {
            challenge,
          };

      const res = await axios.post(
        endpoint,
        payload,
        {
          withCredentials: true,
        }
      );

      setEmailRequest({
        requestId: Number(res.data?.request_id),
        maskedEmail:
          res.data?.masked_email
          || emailStatus.maskedEmail,
      });
      setEmailCode('');
      setCooldown(
        Number(
          res.data?.cooldown_seconds
          || emailStatus.cooldownSeconds
          || 60
        )
      );

      if (mode === 'setup') setSetupChoice('email');
    } catch (error) {
      const retry = Number(
        error.response?.data?.retry_after_seconds || 0
      );

      if (retry > 0) setCooldown(retry);

      onError?.(
        error.response?.data?.error
        || 'No se pudo enviar el código por correo.'
      );
    } finally {
      setEmailLoading(false);
    }
  };

  const verifyEmailCode = async (event) => {
    event.preventDefault();

    if (!emailRequest?.requestId) {
      onError?.('Primero solicita un código por correo.');
      return;
    }

    if (cleanEmailCode.length !== 6) {
      onError?.('Ingresa el código de 6 dígitos recibido por correo.');
      return;
    }

    setEmailLoading(true);
    onError?.('');

    try {
      const endpoint =
        mode === 'setup'
          ? '/api/mfa/email/enroll/verify'
          : '/api/mfa/email/login/verify';

      const res = await axios.post(
        endpoint,
        {
          challenge,
          request_id: emailRequest.requestId,
          code: cleanEmailCode,
        },
        {
          withCredentials: true,
        }
      );

      onComplete?.(res.data?.usuario);
    } catch (error) {
      onError?.(
        error.response?.data?.error
        || 'Código por correo incorrecto.'
      );
    } finally {
      setEmailLoading(false);
    }
  };

  const verifyRecoveryCode = async (event) => {
    event.preventDefault();

    const clean = String(recoveryCode || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);

    if (clean.length !== 8) {
      onError?.('Ingresa un código de recuperación válido.');
      return;
    }

    setRecoveryLoading(true);
    onError?.('');

    try {
      const res = await axios.post(
        '/api/mfa/recovery/verify-login',
        {
          challenge,
          code: clean,
        },
        { withCredentials: true }
      );

      onComplete?.(res.data?.usuario);
    } catch (error) {
      onError?.(
        error.response?.data?.error
        || 'Código de recuperación incorrecto.'
      );
    } finally {
      setRecoveryLoading(false);
    }
  };

  const copyManualKey = async () => {
    const value = String(
      totpSetupData?.manual_key || ''
    ).replace(/\s+/g, '');

    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      onError?.(
        'No se pudo copiar automáticamente. Copia la clave manualmente.'
      );
    }
  };

  const resetSetupChoice = () => {
    setSetupChoice('');
    setTotpSetupData(null);
    setCode('');
    setEmailRequest(null);
    setEmailCode('');
    setCooldown(0);
    onError?.('');
  };

  if (mode === 'setup') {
    if (!setupChoice) {
      return (
        <div className="qc-mfa-panel qc-mfa-setup-choice">
          <div className="qc-mfa-icon" aria-hidden="true">
            <i className="fa-solid fa-shield-halved" />
          </div>

          <h1 id="quick-login-title" className="quick-title">
            Protege tu cuenta
          </h1>

          <p className="qc-mfa-description">
            Es la primera vez que configuras la seguridad. Elige el método que quieres usar.
          </p>

          <div className="qc-mfa-first-choice">
            <button
              type="button"
              onClick={startTotpSetup}
              disabled={totpSetupLoading || emailLoading}
            >
              <span className="qc-mfa-choice-icon blue">
                <i className="fa-solid fa-mobile-screen-button" />
              </span>
              <span className="qc-mfa-choice-copy">
                <strong>Google Authenticator</strong>
                <small>Escanea un QR con tu celular y usa códigos de 6 dígitos.</small>
              </span>
              <i className="fa-solid fa-chevron-right" />
            </button>

            <button
              type="button"
              onClick={() => {
                setSetupChoice('email');
                onError?.('');
              }}
              disabled={totpSetupLoading || emailLoading}
            >
              <span className="qc-mfa-choice-icon violet">
                <i className="fa-regular fa-envelope" />
              </span>
              <span className="qc-mfa-choice-copy">
                <strong>Código por correo</strong>
                <small>Usa un correo real y recibe allí el código de seguridad.</small>
              </span>
              <i className="fa-solid fa-chevron-right" />
            </button>
          </div>

          <p className="qc-mfa-choice-note">
            Después podrás agregar también el otro método desde <strong>Seguridad y dispositivos</strong>.
          </p>

          <button
            type="button"
            className="qc-mfa-back"
            onClick={onCancel}
          >
            <i className="fa-solid fa-arrow-left" />
            Volver al login
          </button>
        </div>
      );
    }

    if (setupChoice === 'email') {
      return (
        <div className="qc-mfa-panel qc-mfa-email-enroll">
          <div className="qc-mfa-icon" aria-hidden="true">
            <i className="fa-regular fa-envelope" />
          </div>

          <h1 id="quick-login-title" className="quick-title">
            Configura tu correo
          </h1>

          <p className="qc-mfa-description">
            Coloca un correo real al que puedas acceder. Te enviaremos un código de 6 dígitos para verificarlo.
          </p>

          {!emailRequest ? (
            <div className="qc-email-enroll-form">
              <label>
                <span>Correo de seguridad</span>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  placeholder="ejemplo@gmail.com"
                  autoComplete="email"
                  disabled={emailLoading}
                />
              </label>

              <button
                type="button"
                className="quick-login-button"
                onClick={() => requestEmailCode({ enrollment: true })}
                disabled={
                  emailLoading
                  || cooldown > 0
                  || !emailInput.trim()
                }
              >
                <i className="fa-regular fa-paper-plane" />
                <span>
                  {emailLoading
                    ? 'Enviando...'
                    : cooldown > 0
                      ? `Reenviar en ${cooldown}s`
                      : 'Enviar código'}
                </span>
              </button>
            </div>
          ) : (
            <form
              className="qc-mfa-form"
              onSubmit={verifyEmailCode}
            >
              <div className="qc-email-destination">
                <i className="fa-regular fa-envelope" />
                <div>
                  <span>Código enviado a</span>
                  <strong>{emailRequest.maskedEmail}</strong>
                </div>
              </div>

              <input
                className="qc-mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={cleanEmailCode}
                onChange={(event) => setEmailCode(event.target.value)}
                autoFocus
                aria-label="Código enviado por correo"
              />

              <button
                className="quick-login-button"
                type="submit"
                disabled={
                  emailLoading
                  || cleanEmailCode.length !== 6
                }
              >
                <i className="fa-solid fa-envelope-circle-check" />
                <span>
                  {emailLoading
                    ? 'Verificando...'
                    : 'Verificar y entrar'}
                </span>
              </button>

              <button
                type="button"
                className="qc-mfa-resend"
                onClick={() => requestEmailCode({ enrollment: true })}
                disabled={emailLoading || cooldown > 0}
              >
                {cooldown > 0
                  ? `Podrás reenviar en ${cooldown}s`
                  : 'Enviar un código nuevo'}
              </button>
            </form>
          )}

          <button
            type="button"
            className="qc-mfa-back"
            onClick={resetSetupChoice}
            disabled={emailLoading}
          >
            <i className="fa-solid fa-arrow-left" />
            Elegir otro método
          </button>
        </div>
      );
    }

    return (
      <div className="qc-mfa-panel qc-mfa-setup">
        <div className="qc-mfa-icon" aria-hidden="true">
          <i className="fa-solid fa-mobile-screen-button" />
        </div>

        <h1 id="quick-login-title" className="quick-title">
          Configura Google Authenticator
        </h1>

        <p className="qc-mfa-description">
          Escanea el QR una sola vez y confirma el código de 6 dígitos.
        </p>

        <div className="qc-mfa-qr-wrap">
          {totpSetupData?.qr_data_url ? (
            <img
              className="qc-mfa-qr"
              src={totpSetupData.qr_data_url}
              alt="Código QR para Google Authenticator"
            />
          ) : (
            <span>Generando QR...</span>
          )}
        </div>

        <div className="qc-mfa-account">
          <span>Cuenta</span>
          <strong>
            {totpSetupData?.account || accountFallback}
          </strong>
        </div>

        <div className="qc-mfa-manual">
          <div>
            <span>¿No puedes escanear el QR?</span>
            <strong>
              {totpSetupData?.manual_key || '—'}
            </strong>
          </div>

          <button
            type="button"
            onClick={copyManualKey}
            aria-label="Copiar clave manual"
          >
            <i className="fa-regular fa-copy" />
          </button>
        </div>

        <ol className="qc-mfa-help">
          <li>Abre Google Authenticator.</li>
          <li>
            Pulsa <strong>+</strong> y escanea el QR o ingresa la clave manual.
          </li>
          <li>Escribe abajo el código de 6 dígitos.</li>
        </ol>

        <form
          onSubmit={submitTotp}
          className="qc-mfa-form"
        >
          <input
            className="qc-mfa-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={cleanCode}
            onChange={(event) => setCode(event.target.value)}
            aria-label="Código de 6 dígitos"
          />

          <button
            className="quick-login-button"
            type="submit"
            disabled={
              loading
              || cleanCode.length !== 6
              || !totpSetupData
            }
          >
            <i className="fa-solid fa-shield-halved" />
            <span>
              {loading
                ? 'Activando...'
                : 'Activar y entrar'}
            </span>
          </button>
        </form>

        <button
          type="button"
          className="qc-mfa-back"
          onClick={resetSetupChoice}
          disabled={loading}
        >
          <i className="fa-solid fa-arrow-left" />
          Elegir otro método
        </button>
      </div>
    );
  }

  const totpAvailable = Boolean(methods?.totp);
  const emailAvailable =
    Boolean(methods?.email)
    && emailStatus.available;

  return (
    <div className="qc-mfa-panel">
      <div className="qc-mfa-icon" aria-hidden="true">
        <i className="fa-solid fa-shield-halved" />
      </div>

      <h1 id="quick-login-title" className="quick-title">
        Verificación en 2 pasos
      </h1>

      <p className="qc-mfa-description">
        Este dispositivo es nuevo. Usa uno de los métodos configurados para autorizarlo.
      </p>

      {totpAvailable && emailAvailable && (
        <div
          className="qc-mfa-methods"
          role="tablist"
          aria-label="Método de verificación"
        >
          <button
            type="button"
            className={method === 'totp' ? 'is-active' : ''}
            onClick={() => {
              setMethod('totp');
              onError?.('');
            }}
          >
            <i className="fa-solid fa-mobile-screen-button" />
            <span>Authenticator</span>
          </button>

          <button
            type="button"
            className={method === 'email' ? 'is-active' : ''}
            onClick={() => {
              setMethod('email');
              onError?.('');
            }}
          >
            <i className="fa-regular fa-envelope" />
            <span>Correo</span>
          </button>
        </div>
      )}

      {totpAvailable && method === 'totp' ? (
        <>
          <p className="qc-mfa-method-copy">
            Abre Google Authenticator y escribe el código de 6 dígitos.
          </p>

          <form
            onSubmit={submitTotp}
            className="qc-mfa-form"
          >
            <input
              className="qc-mfa-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={cleanCode}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
              aria-label="Código de 6 dígitos"
            />

            <button
              className="quick-login-button"
              type="submit"
              disabled={
                loading
                || cleanCode.length !== 6
              }
            >
              <i className="fa-solid fa-shield-halved" />
              <span>
                {loading
                  ? 'Verificando...'
                  : 'Verificar e ingresar'}
              </span>
            </button>
          </form>
        </>
      ) : emailAvailable && method === 'email' ? (
        <div className="qc-email-login-flow">
          <div className="qc-email-destination">
            <i className="fa-regular fa-envelope" />
            <div>
              <span>Código por correo</span>
              <strong>
                {emailRequest?.maskedEmail
                  || emailStatus.maskedEmail}
              </strong>
            </div>
          </div>

          {!emailRequest ? (
            <>
              <p className="qc-mfa-method-copy">
                Te enviaremos un código temporal al correo verificado.
              </p>

              <button
                type="button"
                className="quick-login-button"
                onClick={() => requestEmailCode()}
                disabled={
                  emailLoading
                  || cooldown > 0
                }
              >
                <i className="fa-regular fa-paper-plane" />
                <span>
                  {emailLoading
                    ? 'Enviando...'
                    : cooldown > 0
                      ? `Reenviar en ${cooldown}s`
                      : 'Enviar código al correo'}
                </span>
              </button>
            </>
          ) : (
            <form
              onSubmit={verifyEmailCode}
              className="qc-mfa-form"
            >
              <input
                className="qc-mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={cleanEmailCode}
                onChange={(event) => setEmailCode(event.target.value)}
                autoFocus
                aria-label="Código enviado por correo"
              />

              <button
                className="quick-login-button"
                type="submit"
                disabled={
                  emailLoading
                  || cleanEmailCode.length !== 6
                }
              >
                <i className="fa-solid fa-envelope-circle-check" />
                <span>
                  {emailLoading
                    ? 'Verificando...'
                    : 'Verificar e ingresar'}
                </span>
              </button>

              <button
                type="button"
                className="qc-mfa-resend"
                onClick={() => requestEmailCode()}
                disabled={
                  emailLoading
                  || cooldown > 0
                }
              >
                {cooldown > 0
                  ? `Podrás reenviar en ${cooldown}s`
                  : 'Enviar un código nuevo'}
              </button>
            </form>
          )}
        </div>
      ) : method === 'recovery' ? null : (
        <p className="qc-mfa-email-hint">
          <i className="fa-solid fa-circle-exclamation" />
          No hay un método de verificación disponible. Vuelve al login o comunícate con un administrador.
        </p>
      )}

      {mode === 'verify' && methods?.recovery && method !== 'recovery' && (
        <button
          type="button"
          className="qc-mfa-recovery-link"
          onClick={() => {
            setMethod('recovery');
            setRecoveryCode('');
            onError?.('');
          }}
        >
          <i className="fa-solid fa-key" />
          Usar un código de recuperación
        </button>
      )}

      {mode === 'verify' && method === 'recovery' && methods?.recovery && (
        <form className="qc-mfa-recovery-form" onSubmit={verifyRecoveryCode}>
          <div className="qc-recovery-login-icon">
            <i className="fa-solid fa-key" />
          </div>
          <strong>Código de recuperación</strong>
          <p>Usa uno de los códigos guardados previamente. Cada código sirve una sola vez.</p>
          <input
            type="text"
            autoComplete="one-time-code"
            maxLength={9}
            placeholder="XXXX-XXXX"
            value={recoveryCode}
            onChange={(event) => {
              const clean = event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 8);
              setRecoveryCode(
                clean.length > 4
                  ? `${clean.slice(0, 4)}-${clean.slice(4)}`
                  : clean
              );
            }}
            autoFocus
          />
          <button
            type="submit"
            className="quick-login-button"
            disabled={recoveryLoading || String(recoveryCode).replace(/[^A-Z0-9]/g, '').length !== 8}
          >
            <i className="fa-solid fa-unlock-keyhole" />
            <span>{recoveryLoading ? 'Verificando...' : 'Recuperar acceso'}</span>
          </button>
          {(methods?.totp || methods?.email) && (
            <button
              type="button"
              className="qc-mfa-resend"
              onClick={() => {
                setMethod(methods?.totp ? 'totp' : 'email');
                setRecoveryCode('');
                onError?.('');
              }}
            >
              Volver a los métodos normales
            </button>
          )}
        </form>
      )}

      <button
        type="button"
        className="qc-mfa-back"
        onClick={onCancel}
        disabled={loading || emailLoading || recoveryLoading}
      >
        <i className="fa-solid fa-arrow-left" />
        Volver al login
      </button>
    </div>
  );
}

export default MfaLoginPanel;
