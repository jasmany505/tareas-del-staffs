# KRONIX NETWORK — Centro privado de tareas

Aplicación web sencilla para el equipo de Kronix Network. Se despliega en **Vercel**, el código se guarda en **GitHub** y los datos persistentes se guardan en **Vercel Blob privado**. No usa Firebase, Supabase ni otra plataforma externa.

## Incluye

- Inicio de sesión con usuario y contraseña.
- Creación inicial protegida del primer administrador.
- Panel de administración para crear cuentas, elegir rol, activar/desactivar cuentas y restablecer contraseñas.
- Tareas compartidas visibles para todos los miembros.
- Crear tareas, asignar responsables, prioridad, fecha límite y estado.
- Los miembros pueden cambiar el estado de una tarea; los administradores pueden editar y eliminar tareas.
- Contraseñas almacenadas como hashes `scrypt`; la cookie de sesión es HttpOnly, Secure y SameSite=Strict.
- Los registros de usuarios y tareas se guardan como objetos JSON en un almacén Blob privado. El token del almacén solo se utiliza en el servidor.

## Requisitos

- Cuenta de GitHub.
- Cuenta de Vercel.
- Un proyecto de Vercel con un **Blob store privado** conectado.

> Vercel Blob está disponible en los planes de Vercel, pero puede tener límites de uso. Revisa el uso y los precios de tu cuenta. Este proyecto usa Blob como almacenamiento de objetos para un equipo pequeño; no es una base de datos transaccional. Para un uso de gran escala o escrituras simultáneas frecuentes conviene una base de datos.

## Instalación

### 1. Subir el proyecto a GitHub

1. Descarga y extrae el ZIP.
2. Crea un repositorio nuevo en GitHub, por ejemplo `kronix-network-tareas`.
3. Sube todos los archivos y carpetas de esta carpeta a la raíz del repositorio. No subas archivos `.env` ni tokens.

### 2. Importar en Vercel

1. Entra en https://vercel.com/ y elige **Add New → Project**.
2. Importa el repositorio de GitHub.
3. Deja el framework en **Other** si Vercel no detecta uno.
4. Pulsa Deploy. El primer despliegue puede mostrar un error de configuración hasta que completes las variables y el almacén.

### 3. Crear almacenamiento privado de Vercel

1. Abre el proyecto en Vercel y entra en **Storage**.
2. Elige **Create Database → Blob**.
3. Crea un store con acceso **Private** y conéctalo al proyecto.
4. Vercel debería añadir la variable `BLOB_READ_WRITE_TOKEN` al proyecto. Confirma que existe en **Settings → Environment Variables**.

No elijas un almacén público: los perfiles de usuario y las tareas deben permanecer privados.

### 4. Añadir variables de entorno

En Vercel, abre **Settings → Environment Variables** y añade estas variables en Production (y Preview si también quieres probar allí):

- `SESSION_SECRET`: una cadena aleatoria larga, de al menos 32 caracteres.
- `BOOTSTRAP_SECRET`: otra clave larga y privada, distinta de la anterior.
- `BLOB_READ_WRITE_TOKEN`: se añade al conectar el Blob store; no copies su valor al código ni lo publiques.

Puedes generar dos secretos aleatorios en una terminal local con Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Ejecuta el comando dos veces y usa una salida para cada variable. No compartas estas claves ni las incluyas en GitHub. Después de añadirlas, vuelve a desplegar el proyecto en Vercel (**Deployments → Redeploy**).

### 5. Crear el primer administrador

1. Abre la URL de Vercel del proyecto.
2. Si aún no existe ningún administrador, aparecerá **Crear administrador principal**.
3. Introduce nombre, usuario, contraseña de al menos 10 caracteres y el valor de `BOOTSTRAP_SECRET`.
4. El servidor crea el primer administrador y cierra el acceso de configuración inicial una vez que existe una cuenta de administrador activa.
5. Guarda la contraseña de forma segura. No la publiques en el repositorio ni en Discord.

Si el formulario inicial devuelve que faltan variables, revisa `BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET` y `BOOTSTRAP_SECRET`, y confirma que hiciste redeploy después de guardarlas.

### 6. Uso diario

- Inicia sesión con el usuario y contraseña creados.
- En **Administración → Crear cuenta**, añade cada miembro con usuario, contraseña temporal y rol.
- Comparte las credenciales en privado y pide a cada miembro que cambie su contraseña cuando sea posible. La aplicación no muestra contraseñas existentes; un administrador puede establecer una nueva.
- Crea tareas con el botón **Nueva tarea**. Todos los miembros con sesión iniciada pueden ver todas las tareas.

## Seguridad y límites

- La página no es una web anónima: todos los endpoints de datos requieren sesión, excepto login, estado inicial y configuración inicial protegida por `BOOTSTRAP_SECRET`.
- Los permisos se validan en el servidor; ocultar un botón en el navegador no es la protección principal.
- Mantén el Blob store en modo privado y los secretos solo en Environment Variables de Vercel.
- No guardes información extremadamente sensible en las tareas.
- Haz copias de seguridad periódicas del almacén desde las herramientas de Vercel. No borres el Blob store mientras la aplicación esté en uso.
- El almacenamiento por objetos no ofrece transacciones de base de datos. Si muchos usuarios modifican datos al mismo tiempo, usa una base de datos transaccional.
- Revisa el uso y las condiciones actuales de Vercel antes de publicar la aplicación para el equipo.

## Estructura

```text
.
├── api/
│   └── [...route].js
├── app.js
├── index.html
├── package.json
├── style.css
├── vercel.json
├── .gitignore
└── README.md
```
