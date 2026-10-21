# KRONIX NETWORK — Staff Tasks

Panel privado de tareas para el equipo de KRONIX NETWORK. Frontend estático para GitHub Pages + Supabase Auth, Postgres, Storage privado y Edge Functions opcionales para crear cuentas y enviar avisos a Discord.

## Funciones incluidas

- Inicio de sesión con cuentas creadas por Owners.
- Roles `owner` y `staff`; el rol se guarda en la base de datos y no se toma del navegador.
- Owners crean tareas, asignan a staff, ponen prioridad y fecha límite.
- Staff ve sus tareas y sube una imagen como evidencia (JPG/PNG/WEBP/GIF, máximo 8 MB).
- Bucket privado; las imágenes se abren mediante URL firmada de corta duración.
- Historial de entregas, revisión, aprobación o rechazo con motivo.
- Estadísticas y filtro de estado.
- Funciones Edge opcionales: creación segura de cuentas y avisos de Discord.
- Políticas RLS para limitar las tareas, perfiles, entregas y objetos de Storage.

## 1. Crear proyecto de Supabase

1. Crea un proyecto en https://supabase.com/.
2. Abre **SQL Editor**, crea una consulta y ejecuta el archivo `supabase/schema.sql`.
3. En **Project Settings → API** (o API Keys), copia la **Project URL** y la clave pública **anon/publishable**.
4. Pega esos dos valores en `src/config.js`.
5. En **Authentication → URL Configuration**, configura la URL de tu GitHub Pages como Site URL, por ejemplo `https://TU-USUARIO.github.io/TU-REPOSITORIO/`. Añade esa misma URL a Redirect URLs. Aunque este panel usa email/contraseña, la configuración evita problemas con el flujo de sesión.

> Nunca pegues `service_role` / secret key en `src/config.js`, GitHub, issues, capturas ni mensajes. La clave pública anon es apta para el navegador porque las tablas están protegidas con RLS.

## 2. Crear el primer Owner (bootstrap)

Por seguridad no hay registro público ni ningún botón para que un usuario se vuelva Owner por sí mismo. Crea el primer usuario de manera manual:

1. En Supabase abre **Authentication → Users → Add user → Create new user**.
2. Introduce un correo y una contraseña segura (recomendado 12+ caracteres) y confirma la creación.
3. Copia el UUID del usuario recién creado.
4. En SQL Editor ejecuta esta consulta, reemplazando los valores:
   ```sql
   insert into public.profiles (id, display_name, role, active)
   values ('UUID-DEL-USUARIO', 'Owner Principal', 'owner', true);
   ```
5. Inicia sesión en la web con ese correo y contraseña.

Repite el paso de perfil para cada Owner que ya exista. Para crear futuras cuentas desde la web, despliega la Edge Function `create-staff` y añade un formulario de administración o usa la llamada documentada abajo. **El panel de Owners incluye un formulario para crear Staff u Owners; este formulario llama a la Edge Function y nunca expone la clave de servicio al navegador.

### Crear una cuenta de staff usando la Edge Function

Instala Supabase CLI y autentícate según la guía oficial: https://supabase.com/docs/guides/cli. Desde la carpeta del proyecto:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy create-staff
```

La función usa los secretos de entorno `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, disponibles/configurables en Supabase. No pongas esos secretos en el frontend. Llama a la función con el token de sesión de un Owner activo y la clave pública:

```bash
curl -X POST 'https://TU-PROYECTO.supabase.co/functions/v1/create-staff' \
  -H 'Authorization: Bearer TOKEN_DE_SESION_DEL_OWNER' \
  -H 'apikey: CLAVE_PUBLICA_ANON' \
  -H 'Content-Type: application/json' \
  --data '{"email":"staff@example.com","password":"UnaClaveLargaDe12+","display_name":"Nombre Staff","role":"staff"}'
```

Para dar permisos de Owner a alguien, cambia `role` a `owner` **solo si estás seguro de que debe administrar todo el equipo**. La función solo permite que un Owner activo cree cuentas. La contraseña se entrega de forma privada y se recomienda cambiarla después.

## 3. Desplegar en GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `kronix-staff-tasks`.
2. Sube los archivos y carpetas de este ZIP al nivel raíz del repositorio (no subas el ZIP dentro del repo como único archivo).
3. Edita `src/config.js` con la URL y clave pública de Supabase.
4. Ve a **Settings → Pages**.
5. En **Build and deployment**, selecciona **Deploy from a branch**, branch `main` y carpeta `/ (root)`, luego guarda.
6. Espera el despliegue y abre la URL mostrada por GitHub Pages. Asegúrate de que la URL del sitio esté configurada en Supabase Auth.

También se incluye `.github/workflows/pages.yml` para despliegue automático con GitHub Actions. Si usas ese método, entra en **Settings → Pages** y selecciona **GitHub Actions** como fuente. No configures ambos métodos a la vez.

## 4. Activar avisos de Discord (opcional)

1. Crea un webhook en el canal donde quieres los avisos.
2. Despliega la función:
   ```bash
   supabase functions deploy discord-notify
   ```
3. Guarda el webhook como secreto de Edge Function, nunca en el repositorio:
   ```bash
   supabase secrets set DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/REEMPLAZAR'
   ```
4. La función notifica creación de tarea, nueva evidencia y revisión. Si el secreto no está configurado, el resto de la web sigue funcionando.
5. Limita el acceso al canal de Discord a los miembros que deban ver información del staff.

## 5. Pruebas recomendadas

- Inicia sesión como Owner: crea una tarea asignada a una cuenta staff.
- Inicia sesión como staff: confirma que solo ve sus tareas y sube una imagen.
- Vuelve a iniciar como Owner: revisa la imagen y aprueba/rechaza con motivo.
- Comprueba que una cuenta staff no puede crear tareas, cambiar roles ni leer tareas ajenas.
- Prueba la web desde una ventana privada y otro dispositivo.
- Revisa Supabase → Logs si hay errores de permisos o almacenamiento.

## Seguridad y límites importantes

- GitHub Pages es solo alojamiento estático; Supabase almacena y protege datos y fotos.
- Las imágenes viven en un bucket **privado**. No generes URLs públicas. Los enlaces firmados duran 60 segundos.
- Las políticas RLS son esenciales. No las desactives para “arreglar” errores.
- El archivo `schema.sql` está diseñado para un proyecto Supabase nuevo. Si lo ejecutas más de una vez, los tipos/policies pueden producir errores de “already exists”; no lo ejecutes repetidamente sin revisar.
- El panel usa un aviso de revisión por `prompt()` para mantener el proyecto sencillo. Puede sustituirse por un modal más visual sin cambiar las reglas de seguridad.
- El panel incluye formulario de creación de cuentas que llama a `create-staff`. La gestión avanzada (desactivar usuarios, restablecer contraseñas y cambiar roles de cuentas existentes) se realiza desde Supabase Dashboard en esta primera versión.
- No es una plataforma certificada para evidencias legales. Los Owners deben comprobar manualmente la autenticidad de las capturas.
- Configura backups y usa contraseñas únicas. No compartas el acceso de Owner.

## Archivos principales

- `index.html`, `styles.css`, `src/app.js`, `src/config.js`: interfaz y lógica.
- `supabase/schema.sql`: tablas, RLS, bucket y sincronización de estado.
- `supabase/functions/create-staff/index.ts`: alta segura de cuentas.
- `supabase/functions/discord-notify/index.ts`: avisos opcionales de Discord.
- `.github/workflows/pages.yml`: despliegue automático.
