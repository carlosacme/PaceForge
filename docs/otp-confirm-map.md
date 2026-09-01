# Mapeo — Confirmación de correo con OTP de 6 dígitos

Paso 1 (solo lectura). No hay código todavía. Cuando esto se valide, el Paso 2
toca plantilla de correo (Dashboard) y `ConfirmEmailScreen` / `AuthLanding`.

---

## 0) Cómo está hoy

| Pieza | Dónde | Qué hace |
|---|---|---|
| Registro | `AuthLanding.jsx` ~L285 | `signUp({ email, password, options: { emailRedirectTo: origin + /auth/confirm, data: { full_name, role, coach_id } } })` |
| Tras registrarse | `AuthLanding.jsx` ~L339–465 | Vuelve al **login** con el texto “te enviamos un correo… ábrelo”. Botón **Reenviar correo de confirmación** (`authCanResend`) |
| Plantilla (prod, confirmada por Carlos) | Dashboard → Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup` |
| Canje | `ConfirmEmailScreen.jsx` | **No** auto-canjea. Botón **Confirmar mi correo** → `verifyOtp({ token_hash, type })`. `type` sale de la URL (`signup` en el template actual). Candado `sessionStorage` `raf_otp_<token_hash>` **antes** del POST |
| Reenvío | `resendSignupConfirmation` (`appShared.js` ~L1640) | `supabase.auth.resend({ type: "signup", email })`. Lo usan login y `/auth/confirm` |
| App nativa | `nativeAppLinks.js` + `AndroidManifest` `pathPrefix=/auth/` | Un `https://www.runningapexflow.com/auth/…` abre el WebView en esa ruta. Sin el módulo, Capacitor carga la raíz y el token se pierde |
| Recovery / cambio de correo | Mismo `/auth/confirm` | Distintos `type` en la URL (`recovery`, `email_change`). **Fuera de este mapeo**: no convertirlos a OTP en el v1 |

El GET del enlace **no** gasta el token: solo el POST `verifyOtp`. El candado cubre doble carga en la misma pestaña. Un cliente que pegue a `supabase.co/auth/v1/verify` (`{{ .ConfirmationURL }}`) sí gastaría el token al prefetch; **hoy no usamos esa URL**.

---

## 1) ¿`signUp()` ya puede mandar un código de 6 dígitos?

**No hay un flag en `signUp()` del tipo “manda OTP en vez de link”.**

El mismo `signUp()` (y el mismo `resend({ type: "signup" })`) siempre dispara el mailer **Confirm signup**. Lo que ve el usuario lo decide **la plantilla**:

| Variable | Qué es |
|---|---|
| `{{ .Token }}` | OTP de **6 dígitos** (plaintext). Nativo, no hay que inventar el código |
| `{{ .TokenHash }}` | Hash del mismo token. Sirve para armar el enlace propio (`/auth/confirm?token_hash=…`) |
| `{{ .ConfirmationURL }}` | URL de GoTrue `…/auth/v1/verify?token=…&type=email&redirect_to=…`. Un GET la **consume** |

Son **el mismo secreto**. Canjear el hash o el código de 6 dígitos invalida el otro.

Verificación del código (no del hash), docs actuales:

```js
await supabase.auth.verifyOtp({
  email: "usuario@correo.com",
  token: "123456",   // lo que el usuario teclea
  type: "signup",    // ver nota abajo
})
```

Hace falta **email + token**. Con el enlace actual solo hace falta `token_hash` (el email va implícito en el hash).

**`type`:** el mailer de confirmación de registro es `signup`. Esta app ya canjea el enlace con `type=signup`. En `supabase-js` reciente, `signup` / `magiclink` aparecen como **deprecados** a favor de `type: "email"`. En GoTrue, un OTP de “Confirm signup” históricamente **solo** acepta `signup` (si mandas `email` falla con “invalid”). En implementación: probar en Preview `type: "signup"` primero (alineado con el template y con el enlace de hoy); si GoTrue unificó, caer a `"email"`. `ConfirmEmailScreen` ya tiene allowlist con ambos.

Nada de esto cambia `signUp()` ni `emailRedirectTo`. `emailRedirectTo` solo afecta al link (`RedirectTo` / `ConfirmationURL`), no al valor de `{{ .Token }}`.

---

## 2) Flujo nuevo (diseño)

### Recomendación: **una sola pantalla, dos modos** (no duplicar `finishConfirmed`)

Convertir el botón de `/auth/confirm` **solo** en un input de código rompería recovery / email_change, que siguen siendo enlace. Montar un segundo formulario OTP en `AuthLanding` duplicaría `ensureOwnProfile`, invite pending, éxito “Abre la app”, candados.

`ConfirmEmailScreen` ya es el único sitio que canjea y crea ficha. Se queda:

| Modo | Condición | UI | Canje |
|---|---|---|---|
| **Link** (hoy) | Hay `token_hash` en query/hash | Texto + **Confirmar mi correo** (igual que ahora) | `verifyOtp({ token_hash, type })` |
| **Código** (nuevo) | No hay `token_hash` | Email (prellenado) + 6 dígitos + el mismo botón **Confirmar mi correo** | `verifyOtp({ email, token, type: "signup" })` |

Tras `signUp()` con éxito (hoy: “vuelve al login y revisa el correo”):

1. Guardar el email en `sessionStorage` (p. ej. `raf_pending_confirm_email`).
2. Ir a `/auth/confirm` **sin** `token_hash` → cae en modo código.
3. Copy: “Te enviamos un código de 6 dígitos a {email}. Escríbelo aquí.” Más abajo, el reenvío que ya existe.

Quien abra el enlace con `token_hash` sigue en modo link (un clic). Quien no tenga el hash (registro fresco, deep link limpio, o plantilla sin hash) ve el input.

No hace falta un tercer componente. Recovery no se toca: sigue trayendo `type=recovery` + hash.

### Qué no hacer en v1

- No auto-submit del código (ni al pegar, si se puede evitar): el problema original fue canjear sin gesto.
- No verificar con `{{ .ConfirmationURL }}` (GET a GoTrue).

---

## 3) Plantilla de correo (Dashboard)

Pantalla: **Authentication → Email Templates → Confirm signup**.

`{{ .Token }}` **ya existe**; no hay que generar el código. Hoy la plantilla no lo muestra.

### v1 recomendada (código + enlace SPA, mismo correo)

```html
<h2>Confirma tu correo</h2>
<p>Tu código de 6 dígitos:</p>
<p style="font-size:1.6em;letter-spacing:0.2em;font-weight:700">{{ .Token }}</p>
<p>Escríbelo en la app o en la web. Caduca en unos minutos.</p>
<p>O pulsa el botón (no se activa solo al abrir el correo):</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">
    Confirmar mi correo
  </a>
</p>
```

- El enlace sigue siendo **nuestro** `/auth/confirm?token_hash=…` (GET no consume).
- **No** usar `{{ .ConfirmationURL }}` en el mismo mail: un prefetch de Safe Links/Gmail a GoTrue **quema el OTP y el código a la vez**.

### Si más adelante OTP puro (signup)

Quitar `token_hash` del href. Dejar un enlace **inerte** para abrir la app/web en el formulario:

```html
<a href="{{ .SiteURL }}/auth/confirm">Escribir el código en RunningApexFlow</a>
```

Ese GET no lleva secreto; el intent-filter `/auth/` sigue abriendo la APK.

Magic link, invite, reset password: **otras** plantillas. No mezclar.

---

## 4) Reenviar correo

`resendSignupConfirmation` **no cambia de API**:

```js
supabase.auth.resend({ type: "signup", email })
```

Manda otra vez **Confirm signup** (nuevo `Token` / `TokenHash`). El rate limit de GoTrue sigue (orden de 60 s). Copy del botón puede pasar de “Reenviar correo de confirmación” a “Reenviar código”, pero el método es el mismo.

Si el usuario ya confirmó: mismo `user_already_confirmed` → “inicia sesión con tu contraseña”.

`emailRedirectTo` en el `resend` es opcional y solo afecta al link; el código de 6 dígitos sale igual.

---

## 5) Riesgos

### Reemplazar el link por completo (OTP puro ya)

| Riesgo | Detalle |
|---|---|
| Deep link nativo | `nativeAppLinks` + `pathPrefix=/auth/` asumen un `https://www.runningapexflow.com/auth/…`. Sin **ningún** enlace, el correo no abre la app: el usuario tendría que abrirla a mano y escribir el código. Mitigación: dejar el href **sin** `token_hash` (sección 3, OTP puro) |
| Recovery / invite / email_change | Siguen siendo link. Si se “apaga” `/auth/confirm` o se convierte solo en OTP, se rompen. Por eso dos **modos** en la misma pantalla |
| Un solo token | Código y `token_hash` son el mismo OTP. Quien confirma por un canal invalida el otro (correcto; avisar “si ya confirmaste, entra con tu contraseña”) |
| `type` deprecado | Spike de implementación: `signup` vs `email` (sección 1) |
| UX registro | Hoy el registro **no** lleva a `/auth/confirm`; deja al usuario en login. Sin el salto al modo código, el OTP “existe” en el mail pero la app no pide el número |

### Prefetch

- Enlace actual a **nuestra** SPA: prefetch GET **no** gasta (ya cubierto con el clic).
- `{{ .ConfirmationURL }}`: prefetch **sí** gasta. No usarlo.
- OTP de 6 dígitos: inmune a prefetch (no hay URL secreta). Es la ventaja de largo plazo.

### ¿OTP puro o ambos en v1?

**v1: ambos**, en el mismo correo y en la misma pantalla.

- Casi no hay migración de deep links: el href con `token_hash` que ya está en prod sigue válido.
- Quien no pueda clicar (prefetch agresivo, cliente que “abre” el mail) escribe el código.
- Un solo `finishConfirmed`.
- Coste: un input + un salto post-`signUp` + añadir `{{ .Token }}` a la plantilla.

**OTP puro** cuando el enlace de signup ya no haga falta (o si algún cliente empieza a ejecutar JS / a POSTear). Entonces se quita `token_hash` del template y se deja solo el href inerte a `/auth/confirm`.

No hace falta un flag de `signUp`. No hace falta Edge Function. No hace falta tabla nueva.

---

## 6) Superficie de código (cuando se implemente; no ahora)

1. Dashboard: plantilla Confirm signup (sección 3, v1).
2. `ConfirmEmailScreen`: modo código si no hay `token_hash`; email desde query/`sessionStorage`/`raf_pending_confirm_email`.
3. `AuthLanding`: tras registro OK, guardar email y `location.assign('/auth/confirm')` (o equivalente SPA) en vez de solo el banner de login.
4. Copy de reenvío (opcional).
5. Spike: `verifyOtp` `type: "signup"` vs `"email"` en Preview con una cuenta real.
6. No tocar `resetPasswordForEmail`, plantilla Recovery, ni el candado del link.

---

## 7) Decisión pendiente

- [ ] **v1 ambos** (recomendado): código + enlace SPA con `token_hash`.
- [ ] **OTP puro** ya: quitar `token_hash` del mail de signup; href inerte a `/auth/confirm` para la app.

Cuando esté marcado, Paso 2 = implementar lo de la sección 6.
