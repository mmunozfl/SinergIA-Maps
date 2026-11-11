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
create policy "Lectura publica cuestionarios"
  on public.cuestionarios_sinergia
  for select
  to anon
  using (true);

-- Permite insertar nuevas entrevistas desde la web
create policy "Insercion publica cuestionarios"
  on public.cuestionarios_sinergia
  for insert
  to anon
  with check (true);

-- Permite actualizar si un funcionario vuelve a editar su propia ficha (por correo)
create policy "Actualizacion publica cuestionarios"
  on public.cuestionarios_sinergia
  for update
  to anon
  using (true)
  with check (true);
```

3. Ve a **Project Settings → API** (o *Data API / API Keys*) y copia dos valores públicos:
   * **Project URL** (`https://xxxxx.supabase.co`)
   * **Publishable key** (`sb_publishable_...`) o **anon / public key** (`eyJ...`) — ambas son compatibles.

4. Abre [`data/modelo-sinergia.json`](../data/modelo-sinergia.json) (líneas 15-22) y completa `supabaseUrl` y `supabaseAnonKey`:

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

