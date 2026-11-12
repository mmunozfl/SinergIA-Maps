const AUTH_STORAGE_KEY = 'sinergia_maps_auth_v1';

function getAuthStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getBaseUrl(cfg) {
  return String(cfg?.supabaseUrl || '').trim().replace(/\/$/, '');
}

function normalizeErrorMessage(status, bodyText, fallback) {
  let raw = '';
  try {
    const parsed = JSON.parse(bodyText || '{}');
    raw = parsed.msg || parsed.error_description || parsed.message || parsed.error || '';
  } catch {
    raw = String(bodyText || '');
  }
  const lower = raw.toLowerCase();
  if (status === 429 || lower.includes('rate limit') || lower.includes('security purposes')) {
    return 'Por seguridad debes esperar unos segundos antes de pedir otro correo o código.';
  }
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('token has expired')) {
    return 'El código o enlace es inválido o ya expiró. Solicita uno nuevo.';
  }
  if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return 'Falta permitir el acceso por correo en Supabase Auth (Allow new users to sign up).';
  }
  if (lower.includes('email logins are disabled')) {
    return 'El proveedor Email no está habilitado en Supabase Auth.';
  }
  return raw ? `${fallback} (${raw})` : `${fallback} (${status})`;
}

function parseSessionPayload(data) {
  if (!data?.access_token || !data?.user?.email) {
    throw new Error('La respuesta de Supabase Auth no incluye una sesión válida.');
  }
  const expiresIn = Number(data.expires_in) || 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + expiresIn * 1000,
    user: {
      id: data.user.id || '',
      email: normalizeEmail(data.user.email)
    }
  };
}

/**
 * Lee la sesión de Supabase Auth almacenada localmente (o null si no existe).
 */
export function loadAuthSession() {
  try {
    const storage = getAuthStorage();
    const raw = storage?.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parsed?.user?.email) return null;
    return {
      accessToken: String(parsed.accessToken),
      refreshToken: String(parsed.refreshToken || ''),
      expiresAt: Number(parsed.expiresAt) || 0,
      user: {
        id: String(parsed.user.id || ''),
        email: normalizeEmail(parsed.user.email)
      }
    };
  } catch {
    return null;
  }
}

export function saveAuthSession(session) {
  const storage = getAuthStorage();
  if (!storage) return;
  if (!session) {
    storage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function getAuthUserFromSession(session) {
  return session?.user?.email ? session.user : null;
}

function getMagicLinkRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function fetchAuthUser(cfg, accessToken) {
  const baseUrl = getBaseUrl(cfg);
  const res = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(normalizeErrorMessage(res.status, text, 'No se pudo validar tu sesión'));
  }
  const user = await res.json();
  if (!user?.email) throw new Error('Supabase Auth no devolvió un correo verificado.');
  return {
    id: String(user.id || ''),
    email: normalizeEmail(user.email)
  };
}

/**
 * Procesa callbacks de Magic Link (#access_token=... o ?token_hash=...) y limpia tokens de la URL.
 */
export async function consumeAuthCallback(cfg) {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl || !cfg?.supabaseAnonKey || typeof window === 'undefined') {
    return { status: 'none', session: loadAuthSession() };
  }

  const rawHash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(rawHash);
  const searchParams = new URLSearchParams(window.location.search);

  const authError = hashParams.get('error_description') || hashParams.get('error') || searchParams.get('error_description');
  if (authError) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return {
      status: 'error',
      error: 'El enlace de verificación venció o ya fue utilizado. Solicita uno nuevo.'
    };
  }

  const hashToken = hashParams.get('access_token');
  if (hashToken) {
    const refreshToken = hashParams.get('refresh_token') || '';
    const expiresIn = Number(hashParams.get('expires_in')) || 3600;
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    try {
      const user = await fetchAuthUser(cfg, hashToken);
      const session = {
        accessToken: hashToken,
        refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        user
      };
      saveAuthSession(session);
      return { status: 'authenticated', session };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  const tokenHash = searchParams.get('token_hash');
  const otpType = searchParams.get('type') || 'email';
  if (tokenHash) {
    searchParams.delete('token_hash');
    searchParams.delete('type');
    const nextSearch = searchParams.toString();
    history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`);
    try {
      const res = await fetch(`${baseUrl}/auth/v1/verify`, {
        method: 'POST',
        headers: {
          apikey: cfg.supabaseAnonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token_hash: tokenHash, type: otpType })
      });
      const bodyText = await res.text();
      if (!res.ok) {
        throw new Error(normalizeErrorMessage(res.status, bodyText, 'No se pudo verificar el enlace'));
      }
      const session = parseSessionPayload(JSON.parse(bodyText));
      saveAuthSession(session);
      return { status: 'authenticated', session };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  return { status: 'none', session: loadAuthSession() };
}

/**
 * Envía un código OTP / Magic Link al correo del usuario mediante Supabase Auth.
 */
export async function requestEmailOtp(cfg, email) {
  const baseUrl = getBaseUrl(cfg);
  const cleanEmail = normalizeEmail(email);
  if (!baseUrl || !cfg?.supabaseAnonKey) {
    throw new Error('Supabase Auth no está configurado en esta copia.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Ingresa un correo electrónico válido.');
  }

  const redirectTo = encodeURIComponent(getMagicLinkRedirectUrl());
  const res = await fetch(`${baseUrl}/auth/v1/otp?redirect_to=${redirectTo}`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: cleanEmail,
      create_user: true
    })
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(normalizeErrorMessage(res.status, bodyText, 'No se pudo enviar el correo'));
  }
  return { email: cleanEmail };
}

/**
 * Verifica un código OTP numérico de 6 dígitos enviado al correo.
 */
export async function verifyEmailOtp(cfg, email, token) {
  const baseUrl = getBaseUrl(cfg);
  const cleanEmail = normalizeEmail(email);
  const cleanToken = String(token || '').replace(/\s+/g, '').trim();
  if (!baseUrl || !cfg?.supabaseAnonKey) {
    throw new Error('Supabase Auth no está configurado.');
  }
  if (!cleanToken) {
    throw new Error('Ingresa el código numérico recibido en tu correo.');
  }

  const res = await fetch(`${baseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: cleanEmail,
      token: cleanToken,
      type: 'email'
    })
  });

  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(normalizeErrorMessage(res.status, bodyText, 'No se pudo verificar el código'));
  }

  const session = parseSessionPayload(JSON.parse(bodyText));
  saveAuthSession(session);
  return session;
}

/**
 * Devuelve un accessToken vigente (refrescándolo con refresh_token si está por expirar).
 */
export async function getValidSession(cfg) {
  const current = loadAuthSession();
  if (!current) return null;

  if (!current.expiresAt || current.expiresAt - Date.now() > 60_000) {
    return current;
  }

  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl || !cfg?.supabaseAnonKey || !current.refreshToken) {
    saveAuthSession(null);
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: current.refreshToken })
    });
    if (!res.ok) {
      saveAuthSession(null);
      return null;
    }
    const nextSession = parseSessionPayload(await res.json());
    saveAuthSession(nextSession);
    return nextSession;
  } catch {
    return null;
  }
}

/**
 * Cierra la sesión local y revoca el token en Supabase si sigue activo.
 */
export async function signOutAuth(cfg) {
  const current = loadAuthSession();
  saveAuthSession(null);
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl || !cfg?.supabaseAnonKey || !current?.accessToken) return;
  try {
    await fetch(`${baseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${current.accessToken}`
      }
    });
  } catch {
    // Limpieza local ya efectuada; ignorar fallos de red al cerrar sesión.
  }
}

