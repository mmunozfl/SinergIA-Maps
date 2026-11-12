# Guía de Publicación: GitHub Pages + Supabase en Vivo

Esta guía te permite publicar **SinergIA UCM** con un link público (por ejemplo `https://tu-usuario.github.io/SinergIA/`) y conectarlo a **Supabase** para que **100+ funcionarios** respondan dentro de la app y el mapa se actualice en **menos de 1 segundo** durante tu presentación en vivo.

---

## Paso 1: Crear la tabla gratuita en Supabase (5 minutos)

1. Crea una cuenta gratuita en [supabase.com](https://supabase.com) y pulsa **New Project** (elige nombre `sinergia-ucm` y región más cercana, ej. São Paulo).
2. En el menú lateral abre **SQL Editor → New Query**, pega exactamente este bloque y pulsa **Run**:

```sql
create table if not exists public.cuestionarios_sinergia (
  id text primary key,
  correo text unique not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.cuestionarios_sinergia enable row level security;

-- Permite leer respuestas para dibujar el mapa vivo
drop policy if exists "Lectura publica cuestionarios" on public.cuestionarios_sinergia;
create policy "Lectura publica cuestionarios"
  on public.cuestionarios_sinergia
  for select
  to anon, authenticated
  using (true);

-- Permite insertar nuevas entrevistas por primera vez desde la web
drop policy if exists "Insercion publica cuestionarios" on public.cuestionarios_sinergia;
create policy "Insercion publica cuestionarios"
  on public.cuestionarios_sinergia
  for insert
  to anon, authenticated
  with check (true);

-- Permite editar solo si el correo verificado en Supabase Auth coincide con la ficha
drop policy if exists "Actualizacion publica cuestionarios" on public.cuestionarios_sinergia;
drop policy if exists "Actualizacion por correo verificado" on public.cuestionarios_sinergia;
create policy "Actualizacion por correo verificado"
  on public.cuestionarios_sinergia
  for update
  to authenticated
  using (lower(correo) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(correo) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Permite retirar/eliminar la propia ficha solo al usuario verificado dueño del correo
drop policy if exists "Eliminacion por correo verificado" on public.cuestionarios_sinergia;
create policy "Eliminacion por correo verificado"
  on public.cuestionarios_sinergia
  for delete
  to authenticated
  using (lower(correo) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Tabla opcional para contar globalmente "Personas conectadas" al abrir Chat/Reunión en MS Teams
create table if not exists public.conexiones_sinergia (
  id text primary key,
  from_key text not null,
  to_id text not null,
  channel text not null default 'teams_chat',
  created_at timestamptz not null default now()
);

alter table public.conexiones_sinergia enable row level security;

drop policy if exists "Lectura publica conexiones" on public.conexiones_sinergia;
create policy "Lectura publica conexiones"
  on public.conexiones_sinergia
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Insercion publica conexiones" on public.conexiones_sinergia;
create policy "Insercion publica conexiones"
  on public.conexiones_sinergia
  for insert
  to anon, authenticated
  with check (true);
```

3. Configura **Authentication → URL Configuration**:
   * **Site URL:** `https://mmunozfl.github.io/SinergIA-Maps/`
   * **Redirect URLs:** agrega `https://mmunozfl.github.io/SinergIA-Maps/**`
4. *(Recomendado para que el correo muestre además el código de 6 dígitos)* En **Authentication → Emails → Magic Link**, puedes incluir `{{ .Token }}` en el mensaje (por ejemplo: `Tu código de verificación es {{ .Token }}`) junto al botón/enlace `{{ .ConfirmationURL }}`. Así los usuarios pueden elegir entre hacer clic en el enlace o escribir los 6 dígitos sin cambiar de pestaña.

5. Ve a **Project Settings → API** (o *Data API / API Keys*) y copia dos valores públicos:
   * **Project URL** (`https://xxxxx.supabase.co`)
   * **Publishable key** (`sb_publishable_...`) o **anon / public key** (`eyJ...`) — ambas son compatibles.

6. Abre [`data/modelo-sinergia.json`](../data/modelo-sinergia.json) (líneas 19-26) y completa `supabaseUrl` y `supabaseAnonKey`:

```json
"storageConfig": {
  "mode": "hybrid",
  "repoIndexUrl": "./cuestionarios-realizados/index.json",
  "webhookUrl": "",
  "supabaseUrl": "https://TU-PROYECTO.supabase.co",
  "supabaseAnonKey": "TU-ANON-KEY-PUBLICA",
  "supabaseTable": "cuestionarios_sinergia"
}
```

> **Nota de seguridad:** La clave `anon` está pensada para ir en frontend cuando *Row Level Security (RLS)* está habilitado. **Nunca** pongas la `service_role` key en el repositorio.

---

## Paso 2: Subir a GitHub y activar GitHub Pages

1. Sube esta carpeta completa a un repositorio en GitHub (ej. `SinergIA`).
2. En GitHub, entra a **Settings → Pages**.
3. En **Build and deployment → Source**, elige **Deploy from a branch** → rama `main` → carpeta `/ (root)` y guarda.
4. En ~1 minuto tendrás tu enlace listo (`https://tu-usuario.github.io/SinergIA/`).
5. Verás arriba a la derecha la insignia dorada **"En vivo"**: mientras proyectas el **Mapa SinergIA**, la app sincroniza automáticamente cada **8 segundos** (y también puedes usar el botón **↻ Sincronizar**).

---

## Paso 3 (Opcional): Respaldar respuestas en la carpeta `cuestionarios-realizados/` de GitHub

En cualquier momento (por ejemplo, antes de cerrar la entrega en BUK), puedes ir a la pestaña **Cruces y Directorio → Importar o respaldar respuestas reales → Exportar índice JSON** y reemplazar [`cuestionarios-realizados/index.json`](../cuestionarios-realizados/index.json) en tu repositorio. Así conservas un respaldo histórico dentro de GitHub además de Supabase.

