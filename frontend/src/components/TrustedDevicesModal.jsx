import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import "../css/TrustedDevices.css";

const formatDate = (value) => {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

function TrustedDevicesModal({
  usuarioId,
  onClose,
}) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revokingId, setRevokingId] = useState(null);

  const [methods, setMethods] = useState({
    loading: true,
    totpEnabled: false,
    emailEnabled: false,
  });

  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);

  const [emailState, setEmailState] = useState({
    loading: true,
    recoveryEmail: "",
    maskedEmail: "",
    enabled: false,
    verifiedAt: null,
    cooldownSeconds: 60,
  });

  const [emailInput, setEmailInput] = useState("");
  const [emailRequest, setEmailRequest] = useState(null);
  const [emailCode, setEmailCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);

  const [recoveryStatus, setRecoveryStatus] = useState({
    loading: true,
    available: 0,
    lastGeneratedAt: null,
  });
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const headers = useMemo(
    () => ({
      "X-QC-User-Id": String(usuarioId || ""),
    }),
    [usuarioId]
  );

  const requestOptions = useMemo(
    () => ({
      headers,
      withCredentials: true,
    }),
    [headers]
  );

  const loadDevices = useCallback(async () => {
    if (!usuarioId) return;

    setLoading(true);
    setError("");

    try {
      const res = await axios.get(
        "/api/mfa/devices",
        requestOptions
      );

      setDevices(
        Array.isArray(res.data?.devices)
          ? res.data.devices
          : []
      );
    } catch (err) {
      setError(
        err.response?.data?.error
        || "No se pudieron cargar los dispositivos confiables."
      );
    } finally {
      setLoading(false);
    }
  }, [requestOptions, usuarioId]);

  const loadMethods = useCallback(async () => {
    if (!usuarioId) return;

    setMethods((current) => ({
      ...current,
      loading: true,
    }));

    try {
      const res = await axios.get(
        "/api/mfa/methods",
        requestOptions
      );

      setMethods({
        loading: false,
        totpEnabled: Boolean(
          res.data?.totp_enabled
        ),
        emailEnabled: Boolean(
          res.data?.email_enabled
        ),
      });
    } catch (err) {
      setMethods((current) => ({
        ...current,
        loading: false,
      }));

      setError(
        err.response?.data?.error
        || "No se pudieron cargar los métodos de seguridad."
      );
    }
  }, [requestOptions, usuarioId]);

  const loadEmail = useCallback(async () => {
    if (!usuarioId) return;

    setEmailState((current) => ({
      ...current,
      loading: true,
    }));

    try {
      const res = await axios.get(
        "/api/mfa/email",
        requestOptions
      );

      const recoveryEmail =
        res.data?.recovery_email || "";

      setEmailState({
        loading: false,
        recoveryEmail,
        maskedEmail:
          res.data?.masked_email || "",
        enabled: Boolean(
          res.data?.email_enabled
        ),
        verifiedAt:
          res.data?.email_verified_at || null,
        cooldownSeconds: Number(
          res.data?.cooldown_seconds || 60
        ),
      });

      if (recoveryEmail) {
        setEmailInput(recoveryEmail);
      }
    } catch (err) {
      setEmailState((current) => ({
        ...current,
        loading: false,
      }));

      setError(
        err.response?.data?.error
        || "No se pudo cargar el correo alternativo."
      );
    }
  }, [requestOptions, usuarioId]);

  const loadRecovery = useCallback(async () => {
    if (!usuarioId) return;

    setRecoveryStatus((current) => ({ ...current, loading: true }));
    try {
      const res = await axios.get('/api/mfa/recovery/status', requestOptions);
      setRecoveryStatus({
        loading: false,
        available: Number(res.data?.available || 0),
        lastGeneratedAt: res.data?.last_generated_at || null,
      });
    } catch (err) {
      setRecoveryStatus((current) => ({ ...current, loading: false }));
      setError(err.response?.data?.error || 'No se pudieron cargar los códigos de recuperación.');
    }
  }, [requestOptions, usuarioId]);

  const generateRecoveryCodes = async () => {
    if (recoveryStatus.available > 0) {
      const ok = window.confirm(
        'Generar códigos nuevos revocará todos los códigos de recuperación anteriores que todavía no se usaron. ¿Continuar?'
      );
      if (!ok) return;
    }

    setRecoveryBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await axios.post('/api/mfa/recovery/generate', {}, requestOptions);
      setRecoveryCodes(Array.isArray(res.data?.codes) ? res.data.codes : []);
      setNotice('Códigos generados. Guárdalos ahora: por seguridad sólo se muestran en esta pantalla una vez.');
      await loadRecovery();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudieron generar los códigos de recuperación.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes.length) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setNotice('Códigos de recuperación copiados. Guárdalos en un lugar seguro.');
    } catch {
      setError('No se pudieron copiar automáticamente. Cópielos manualmente.');
    }
  };

  useEffect(() => {
    loadDevices();
    loadMethods();
    loadEmail();
    loadRecovery();
  }, [
    loadDevices,
    loadMethods,
    loadEmail,
    loadRecovery,
  ]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener(
      "keydown",
      onKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown
      );
    };
  }, [onClose]);

  useEffect(() => {
    if (emailCooldown <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setEmailCooldown((current) =>
        Math.max(0, current - 1)
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [emailCooldown]);

  const copyTotpKey = async () => {
    const value = String(
      totpSetup?.manual_key || ""
    ).replace(/\s+/g, "");

    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setNotice("Clave manual copiada.");
    } catch {
      setError(
        "No se pudo copiar automáticamente."
      );
    }
  };

  const startTotpSetup = async () => {
    setTotpBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await axios.post(
        "/api/mfa/totp/setup/start",
        {},
        requestOptions
      );

      setTotpSetup(res.data);
      setTotpCode("");
    } catch (err) {
      setError(
        err.response?.data?.error
        || "No se pudo preparar Google Authenticator."
      );
    } finally {
      setTotpBusy(false);
    }
  };

  const verifyTotpSetup = async () => {
    const code = String(
      totpCode || ""
    ).replace(/\D/g, "").slice(0, 6);

    if (code.length !== 6) {
      setError(
        "Ingresa los 6 dígitos de Google Authenticator."
      );
      return;
    }

    setTotpBusy(true);
    setError("");
    setNotice("");

    try {
      await axios.post(
        "/api/mfa/totp/setup/verify",
        { code },
        requestOptions
      );

      setTotpSetup(null);
      setTotpCode("");
      setNotice(
        "Google Authenticator fue agregado correctamente."
      );
      await loadMethods();
    } catch (err) {
      setError(
        err.response?.data?.error
        || "No se pudo confirmar Google Authenticator."
      );
    } finally {
      setTotpBusy(false);
    }
  };

  const requestEmailVerification = async () => {
    const email = String(
      emailInput || ""
    ).trim();

    if (
      !email ||
      !email.includes("@")
    ) {
      setError(
        "Ingresa un correo alternativo válido."
      );
      return;
    }

    setEmailBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await axios.post(
        "/api/mfa/email/setup/request",
        { email },
        requestOptions
      );

      setEmailRequest({
        requestId: Number(
          res.data?.request_id
        ),
        maskedEmail:
          res.data?.masked_email || email,
      });

      setEmailCode("");

      setEmailCooldown(
        Number(
          res.data?.cooldown_seconds
          || emailState.cooldownSeconds
          || 60
        )
      );

      setNotice(
        "Código enviado. Revisa ese correo e ingresa los 6 dígitos."
      );
    } catch (err) {
      const retry = Number(
        err.response?.data
          ?.retry_after_seconds || 0
      );

      if (retry > 0) {
        setEmailCooldown(retry);
      }

      setError(
        err.response?.data?.error
        || "No se pudo enviar el código al correo."
      );
    } finally {
      setEmailBusy(false);
    }
  };

  const verifyEmail = async () => {
    const code = String(
      emailCode || ""
    ).replace(/\D/g, "").slice(0, 6);

    if (!emailRequest?.requestId) {
      setError(
        "Primero solicita un código de verificación."
      );
      return;
    }

    if (code.length !== 6) {
      setError(
        "Ingresa los 6 dígitos recibidos por correo."
      );
      return;
    }

    setEmailBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await axios.post(
        "/api/mfa/email/setup/verify",
        {
          request_id:
            emailRequest.requestId,
          code,
        },
        requestOptions
      );

      setEmailRequest(null);
      setEmailCode("");
      setNotice(
        "Correo alternativo verificado correctamente."
      );

      setEmailState((current) => ({
        ...current,
        recoveryEmail:
          res.data?.recovery_email
          || emailInput.trim(),
        maskedEmail:
          res.data?.masked_email
          || emailInput.trim(),
        enabled: true,
        verifiedAt:
          new Date().toISOString(),
      }));

      await loadEmail();
      await loadMethods();
    } catch (err) {
      setError(
        err.response?.data?.error
        || "No se pudo verificar el código del correo."
      );
    } finally {
      setEmailBusy(false);
    }
  };

  const removeEmail = async () => {
    if (
      !window.confirm(
        "¿Eliminar el correo alternativo?"
      )
    ) {
      return;
    }

    setEmailBusy(true);
    setError("");
    setNotice("");

    try {
      await axios.delete(
        "/api/mfa/email",
        requestOptions
      );

      setEmailState({
        loading: false,
        recoveryEmail: "",
        maskedEmail: "",
        enabled: false,
        verifiedAt: null,
        cooldownSeconds:
          emailState.cooldownSeconds || 60,
      });

      setEmailInput("");
      setEmailRequest(null);
      setEmailCode("");
      setNotice(
        "Correo alternativo eliminado."
      );

      await loadMethods();
    } catch (err) {
      setError(
        err.response?.data?.error
        || "No se pudo eliminar el correo alternativo."
      );
    } finally {
      setEmailBusy(false);
    }
  };

  const revoke = async (device) => {
    const message = device.current
      ? "¿Revocar este dispositivo? En el próximo login volverá a pedir un método de seguridad."
      : `¿Revocar ${device.nombre || "este dispositivo"}?`;

    if (!window.confirm(message)) return;

    setRevokingId(device.id);
    setError("");
    setNotice("");

    try {
      const res = await axios.delete(
        `/api/mfa/devices/${device.id}`,
        requestOptions
      );

      setDevices((current) =>
        current.filter(
          (item) => item.id !== device.id
        )
      );

      if (res.data?.current_revoked) {
        setNotice(
          "Este equipo fue revocado. La sesión actual continúa, pero el próximo login pedirá verificación."
        );
      }
    } catch (err) {
      setError(
        err.response?.data?.error
        || "No se pudo revocar el dispositivo."
      );
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div
      className="qc-devices-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget
        ) {
          onClose?.();
        }
      }}
    >
      <section
        className="qc-devices-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qc-devices-title"
      >
        <header className="qc-devices-header">
          <div className="qc-devices-icon">
            <i className="fa-solid fa-shield-halved" />
          </div>

          <div>
            <h2 id="qc-devices-title">
              Seguridad y dispositivos
            </h2>
            <p>
              Métodos de verificación y equipos confiables.
            </p>
          </div>

          <button
            type="button"
            className="qc-devices-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className="qc-devices-info">
          <i className="fa-solid fa-circle-info" />
          <span>
            Puedes usar sólo Authenticator, sólo correo o ambos. Si tienes ambos, una PC nueva te permitirá elegir.
          </span>
        </div>

        {error && (
          <div
            className="qc-devices-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            className="qc-devices-notice"
            role="status"
          >
            {notice}
          </div>
        )}

        <div className="qc-devices-list">
          <section className="qc-security-methods-summary">
            <div className="qc-method-summary-card">
              <span className="qc-method-summary-icon blue">
                <i className="fa-solid fa-mobile-screen-button" />
              </span>

              <div>
                <strong>
                  Google Authenticator
                </strong>
                <small>
                  {methods.loading
                    ? "Consultando..."
                    : methods.totpEnabled
                      ? "Activado"
                      : "No configurado"}
                </small>
              </div>

              {!methods.loading && (
                <span
                  className={
                    methods.totpEnabled
                      ? "qc-method-status active"
                      : "qc-method-status"
                  }
                >
                  {methods.totpEnabled
                    ? "Activo"
                    : "Pendiente"}
                </span>
              )}
            </div>

            {!methods.loading
              && !methods.totpEnabled
              && !totpSetup && (
                <button
                  type="button"
                  className="qc-method-add-button"
                  onClick={startTotpSetup}
                  disabled={totpBusy}
                >
                  <i className="fa-solid fa-plus" />
                  {totpBusy
                    ? "Preparando..."
                    : "Agregar Google Authenticator"}
                </button>
              )}

            {totpSetup && (
              <div className="qc-totp-inline-setup">
                <div className="qc-totp-inline-grid">
                  <img
                    src={totpSetup.qr_data_url}
                    alt="QR para Google Authenticator"
                  />

                  <div className="qc-totp-inline-copy">
                    <strong>
                      Escanea este QR
                    </strong>
                    <span>
                      Después escribe el código de 6 dígitos.
                    </span>

                    <div className="qc-totp-manual-key">
                      <code>
                        {totpSetup.manual_key}
                      </code>
                      <button
                        type="button"
                        onClick={copyTotpKey}
                      >
                        <i className="fa-regular fa-copy" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="qc-totp-code-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={String(
                      totpCode || ""
                    )
                      .replace(/\D/g, "")
                      .slice(0, 6)}
                    onChange={(event) =>
                      setTotpCode(
                        event.target.value
                      )
                    }
                  />

                  <button
                    type="button"
                    onClick={verifyTotpSetup}
                    disabled={
                      totpBusy
                      || String(
                        totpCode || ""
                      ).replace(/\D/g, "")
                        .length !== 6
                    }
                  >
                    {totpBusy
                      ? "Verificando..."
                      : "Activar"}
                  </button>
                </div>

                <button
                  type="button"
                  className="qc-inline-cancel"
                  onClick={() => {
                    setTotpSetup(null);
                    setTotpCode("");
                    setError("");
                  }}
                  disabled={totpBusy}
                >
                  Cancelar
                </button>
              </div>
            )}
          </section>

          <section className="qc-email-security-card">
            <div className="qc-email-security-heading">
              <span className="qc-email-security-icon">
                <i className="fa-regular fa-envelope" />
              </span>

              <div>
                <h3>
                  Correo alternativo
                </h3>
                <p>
                  Puedes usarlo como método principal o como método adicional.
                </p>
              </div>

              {emailState.enabled && (
                <span className="qc-email-verified-badge">
                  <i className="fa-solid fa-circle-check" />
                  Verificado
                </span>
              )}
            </div>

            {emailState.loading ? (
              <div className="qc-email-security-loading">
                <i className="fa-solid fa-spinner fa-spin" />
                Cargando...
              </div>
            ) : (
              <>
                {emailState.enabled && (
                  <div className="qc-email-current">
                    <div>
                      <span>
                        Correo activo
                      </span>
                      <strong>
                        {emailState.recoveryEmail}
                      </strong>
                      <small>
                        Verificado:{" "}
                        {formatDate(
                          emailState.verifiedAt
                        )}
                      </small>
                    </div>

                    <button
                      type="button"
                      onClick={removeEmail}
                      disabled={
                        emailBusy
                        || !methods.totpEnabled
                      }
                      title={
                        !methods.totpEnabled
                          ? "Agrega Google Authenticator antes de eliminar tu único método."
                          : ""
                      }
                    >
                      Eliminar
                    </button>
                  </div>
                )}

                {emailState.enabled
                  && !methods.totpEnabled && (
                    <p className="qc-only-method-warning">
                      <i className="fa-solid fa-lock" />
                      Este correo es tu único método de seguridad. No puede eliminarse hasta agregar Authenticator.
                    </p>
                  )}

                <label className="qc-email-field">
                  <span>
                    {emailState.enabled
                      ? "Cambiar correo alternativo"
                      : "Correo alternativo"}
                  </span>

                  <input
                    type="email"
                    value={emailInput}
                    onChange={(event) => {
                      setEmailInput(
                        event.target.value
                      );
                      setEmailRequest(null);
                      setEmailCode("");
                    }}
                    placeholder="ejemplo@gmail.com"
                    autoComplete="email"
                    disabled={emailBusy}
                  />
                </label>

                {!emailRequest ? (
                  <button
                    type="button"
                    className="qc-email-primary"
                    onClick={
                      requestEmailVerification
                    }
                    disabled={
                      emailBusy
                      || emailCooldown > 0
                      || !emailInput.trim()
                    }
                  >
                    <i className="fa-regular fa-paper-plane" />
                    {emailBusy
                      ? "Enviando..."
                      : emailCooldown > 0
                        ? `Reenviar en ${emailCooldown}s`
                        : "Enviar código de verificación"}
                  </button>
                ) : (
                  <div className="qc-email-verify-box">
                    <p>
                      Código enviado a{" "}
                      <strong>
                        {emailRequest.maskedEmail}
                      </strong>
                    </p>

                    <div className="qc-email-code-row">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        value={String(
                          emailCode || ""
                        )
                          .replace(/\D/g, "")
                          .slice(0, 6)}
                        onChange={(event) =>
                          setEmailCode(
                            event.target.value
                          )
                        }
                        disabled={emailBusy}
                      />

                      <button
                        type="button"
                        onClick={verifyEmail}
                        disabled={
                          emailBusy
                          || String(
                            emailCode || ""
                          ).replace(/\D/g, "")
                            .length !== 6
                        }
                      >
                        {emailBusy
                          ? "Verificando..."
                          : "Verificar"}
                      </button>
                    </div>

                    <button
                      type="button"
                      className="qc-email-resend"
                      onClick={
                        requestEmailVerification
                      }
                      disabled={
                        emailBusy
                        || emailCooldown > 0
                      }
                    >
                      {emailCooldown > 0
                        ? `Podrás reenviar en ${emailCooldown}s`
                        : "Enviar un código nuevo"}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="qc-recovery-security-card">
            <div className="qc-recovery-security-heading">
              <span className="qc-recovery-security-icon">
                <i className="fa-solid fa-key" />
              </span>
              <div>
                <h3>Códigos de recuperación</h3>
                <p>Úsalos si pierdes acceso al teléfono y al correo. Cada código funciona una sola vez.</p>
              </div>
              {!recoveryStatus.loading && (
                <span className="qc-recovery-count-badge">
                  {recoveryStatus.available} disponibles
                </span>
              )}
            </div>

            {recoveryCodes.length > 0 && (
              <div className="qc-recovery-codes-once">
                <div className="qc-recovery-warning">
                  <i className="fa-solid fa-triangle-exclamation" />
                  Estos códigos no volverán a mostrarse. Guárdalos antes de cerrar esta ventana.
                </div>
                <div className="qc-recovery-code-grid">
                  {recoveryCodes.map((code) => (
                    <code key={code}>{code}</code>
                  ))}
                </div>
                <button type="button" className="qc-recovery-copy" onClick={copyRecoveryCodes}>
                  <i className="fa-regular fa-copy" /> Copiar todos
                </button>
              </div>
            )}

            <button
              type="button"
              className="qc-recovery-generate"
              onClick={generateRecoveryCodes}
              disabled={recoveryBusy || recoveryStatus.loading}
            >
              <i className="fa-solid fa-key" />
              {recoveryBusy
                ? 'Generando...'
                : recoveryStatus.available > 0
                  ? 'Generar códigos nuevos'
                  : 'Generar códigos de recuperación'}
            </button>
          </section>

          <div className="qc-devices-section-title">
            <div>
              <h3>
                Dispositivos confiables
              </h3>
              <p>
                Equipos que ya superaron una verificación.
              </p>
            </div>

            <button
              type="button"
              onClick={loadDevices}
              disabled={loading}
              aria-label="Actualizar dispositivos"
            >
              <i
                className={`fa-solid fa-rotate ${
                  loading ? "fa-spin" : ""
                }`}
              />
            </button>
          </div>

          {loading ? (
            <div className="qc-devices-empty">
              <i className="fa-solid fa-spinner fa-spin" />
              Cargando dispositivos...
            </div>
          ) : devices.length === 0 ? (
            <div className="qc-devices-empty">
              No hay dispositivos confiables activos.
            </div>
          ) : (
            devices.map((device) => (
              <article
                className={`qc-device-card ${
                  device.current
                    ? "is-current"
                    : ""
                }`}
                key={device.id}
              >
                <div className="qc-device-main">
                  <span className="qc-device-computer">
                    <i className="fa-solid fa-display" />
                  </span>

                  <div className="qc-device-copy">
                    <div className="qc-device-title-row">
                      <strong>
                        {device.nombre
                          || "Dispositivo"}
                      </strong>

                      {device.current && (
                        <span className="qc-current-badge">
                          Este dispositivo
                        </span>
                      )}
                    </div>

                    <small>
                      Último uso:{" "}
                      {formatDate(
                        device.last_used_at
                      )}
                    </small>
                    <small>
                      Autorizado:{" "}
                      {formatDate(
                        device.created_at
                      )}
                    </small>
                    <small>
                      Confianza hasta:{" "}
                      {formatDate(
                        device.expires_at
                      )}
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  className="qc-device-revoke"
                  onClick={() =>
                    revoke(device)
                  }
                  disabled={
                    revokingId === device.id
                  }
                >
                  <i className="fa-solid fa-ban" />
                  {revokingId === device.id
                    ? "Revocando..."
                    : "Revocar"}
                </button>
              </article>
            ))
          )}
        </div>

        <footer className="qc-devices-footer">
          <button
            type="button"
            onClick={() => {
              loadDevices();
              loadMethods();
              loadEmail();
              loadRecovery();
            }}
            disabled={
              loading
              || methods.loading
              || emailState.loading
            }
          >
            <i className="fa-solid fa-rotate" />
            Actualizar
          </button>

          <button
            type="button"
            className="primary"
            onClick={onClose}
          >
            Listo
          </button>
        </footer>
      </section>
    </div>
  );
}

export default TrustedDevicesModal;
