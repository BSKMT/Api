# Procedimiento de respuesta al incidente de exposición de secretos

> **Estado del incidente:** El archivo `.env` fue commiteado en el commit
> inicial `bd3f9752` del repositorio `github.com/BSKMT/Api`. Aunque se
> agregó a `.gitignore` posteriormente (commit `6b6b9daa`), el contenido
> sigue recuperable del historial. Adicionalmente, un GitHub Personal
> Access Token estaba embebido en el remote URL del `.git/config` local;
> ese PAT ya fue removido del remote mediante `git remote set-url`.

## Secretos expuestos · Rotación obligatoria

Antes de aplicar el parche de código, rotar TODOS los secretos enumerados
a continuación, en el orden indicado:

| Secreto | Dónde rotarlo | Acción posterior |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas → cambiar la contraseña del usuario applicational | Actualizar todas las apps que la leen (API + landing page) |
| `BETTER_AUTH_SECRET` | Regenerar (`openssl rand -hex 32`) | **Invalida todas las sesiones activas** — coordinar con ventana de mantenimiento |
| `BOLD_SECRET_KEY`, `BOLD_IDENTITY_KEY`, `BOLD_PUBLIC_KEY` | Panel de Bold → regenerar credenciales del comercio | Actualizar webhook HMAC + integrity signature |
| `ZOHO_CLIENT_SECRET` + `ZOHO_REFRESH_TOKEN` | Zoho API Console → revocar y re-otorgar | Actualizar el servicio de envío de correo |
| *GitHub PAT `ghp_...`* | GitHub → Settings → Developer settings → Personal access tokens → Revoke | Crear un PAT nuevo con scope mínimo (`repo`) usando credential helper |

## Purga del historial de Git

La rotación elimina el daño futuro, pero el `.env` sigue accesible en el
historial público. Para retirarlo por completo:

```bash
# 1) Instala git-filter-repo (preferido sobre BFG por soporte de partes del archivo)
pipx install git-filter-repo

# 2) Crea un backup del repo primero
git clone --mirror https://github.com/BSKMT/Api.git api-mirror-backup

# 3) En un clone de trabajo, ejecuta el filtro para eliminar .env del historial
cd api-mirror-backup
git filter-repo --invert-paths --path .env --force

# 4) Re-escribe las referencias y fuerza el push al remoto
git push --force --mirror origin
#                            ^^^^^^^^ (necesario aunque normalmente evitamos force-push)

# 5) Limpia caches de fetch en todos los clones locales
git fetch --all --prune
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

> ⚠️ Este procedimiento cambia los hashes de TODOS los commits desde el
> inicial hacia adelante. Cualquier desarrollador con un clone local
> debe hacer un `git fetch && git reset --hard origin/main` para
> alinearse (sus commits locales sin push deben ser re-baseados).

## Verificación post-rotación

1. `git log --all --full-history -- .env` → sin resultados.
2. Búsqueda en GitHub del valor antiguo de `MONGODB_URI` (`site:github.com "..."`) → sin resultados.
3. Auditar accesos sospechosos en MongoDB Atlas, Bold, Zoho y GitHub
   durante los 90 días posteriores a la exposición.
4. Confirmar que los webhooks de Bold siguen llegando correctamente
   tras rotar `BOLD_SECRET_KEY`.

## Estado actual (post-fix)

- `.git/config` local: PAT eliminado del remote URL (cambio no tracked).
- `.gitignore` mantiene `.env` ignorado como ya estaba.
- Las variables de entorno deben ser cargadas exclusivamente desde el
  proveedor de secretos del despliegue (Vercel env vars / configuración
  del orquestador), nunca desde el repositorio.

Este documento es parte del plan de respuesta al incidente CRÍTICO-1
(C-1) del informe de auditoría.