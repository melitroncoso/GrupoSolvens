# Grupo Solvens · Sistema de Visitas

Sistema web para gestionar las visitas de reposición de Grupo Solvens en sucursales de supermercados. Los repositores registran cada visita desde el celular con el stock relevado y fotos de la góndola. Los supervisores siguen su zona, administración revisa y aprueba las fotos, y cada cliente ve el resultado de las visitas a sus productos.

## Roles

| Rol | Qué hace |
|---|---|
| **Repositor** | Carga visitas: elige cliente y sucursal (solo las de su zona), releva el stock por categoría de producto, marca góndola cuando aplica y sube fotos. Consulta sus visitas del mes. |
| **Supervisor** | Ve las fotos y visitas de las zonas y clientes que tiene asignados. |
| **Administrador** | Gestiona usuarios, cadenas, sucursales, categorías y productos. Asigna zonas. Aprueba, rechaza o rota fotos y visitas. Exporta reportes. |
| **Cliente** | Ve las fotos aprobadas de sus productos y el resumen semanal de visitas. |

## Funcionalidades

- **Carga de visitas desde el celular** con relevamiento de stock por categoría (tipos de stock configurables) y hasta 3 o 5 fotos según el cliente.
- **Acceso por zona y subzona**: el backend valida que cada repositor solo cargue visitas en sucursales de su zona. GBA y CABA comparten visibilidad.
- **Procesamiento de imágenes**: las fotos se corrigen de orientación, se redimensionan y se comprimen a JPEG con `sharp` antes de subirse a Cloudflare R2. Las fotos HEIC de iPhone se detectan y el usuario recibe un mensaje claro sobre cómo resolverlo.
- **Flujo de aprobación** de fotos y visitas (Pendiente, Aprobado, Rechazado) antes de que las vea el cliente.
- **Visor de fotos** con lightbox, zoom y desplazamiento.
- **Reportes**: exportación a PowerPoint (`pptxgenjs`) con las fotos de cada visita y exportación a Excel con stock por zona.
- **Filtros multiselección en cascada** por zona, subzona, cadena, sucursal, cliente y fecha.
- **Contraseñas con bcrypt**, con migración automática de las contraseñas viejas en texto plano al iniciar sesión.

## Stack

- **Frontend:** HTML, CSS y JavaScript sin frameworks (una página por vista)
- **Backend:** Node.js con Express 5 (ES Modules)
- **Base de datos:** PostgreSQL (`pg`)
- **Almacenamiento de imágenes:** Cloudflare R2 a través de la API de S3 (`@aws-sdk/client-s3`)
- **Imágenes:** `multer` (en memoria) y `sharp`
- **Reportes:** `pptxgenjs`

## Estructura

```
GrupoSolvens/
├── package.json
├── IMG/                      Imágenes locales heredadas (servidas en /IMG)
└── CODIGO/
    ├── *.html                Una página por vista (login, inicio por rol, ABM, tablas, fotos)
    ├── js/
    │   ├── server.mjs        API REST y servidor de archivos estáticos
    │   ├── conexion.mjs      Pool de conexiones a PostgreSQL
    │   ├── filtros.js        Lógica de filtros compartida
    │   └── modal_confirmacion.js
    └── style/                Hojas de estilo por sección (shared.css es la base)
```

## Modelo de datos

Tablas principales: `usuario`, `tipo_usuario`, `zona`, `subzona`, `sucursal`, `cadena`, `tipo_cadena`, `categoria`, `producto`, `tipo_stock`, `visita`, `visita_stock`, `imagen`, `abastece` (qué cliente se repone en qué sucursal) y `supervisa` (qué zonas y clientes ve cada supervisor).

## Instalación

Requisitos: Node.js 18 o superior, una base PostgreSQL y un bucket de Cloudflare R2.

```bash
git clone https://github.com/melitroncoso/GrupoSolvens.git
cd GrupoSolvens
npm install
```

Creá un archivo `.env` (o configurá las variables en tu hosting):

```env
DATABASE_URL=postgresql://usuario:clave@host:5432/base
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
PORT=3000
```

Levantá el servidor:

```bash
node CODIGO/js/server.mjs
```

Y entrá a `http://localhost:3000`.

> El script `npm start` apunta a `server.mjs` en la raíz, pero el servidor está en `CODIGO/js/`. Hasta corregir `package.json`, usá el comando de arriba.

## Despliegue

Pensado para correr en Render (o cualquier hosting de Node) con PostgreSQL administrado y Cloudflare R2. La conexión a la base usa SSL.

## Equipo

Patricio Altamiranda, [@melitroncoso](https://github.com/melitroncoso), MatyBotta / Matías Bottarini y colaboradores.

## Licencia

Uso privado de Grupo Solvens. Todos los derechos reservados.
