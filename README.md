# Grupo Solvens · Sistema de Visitas

Sistema web para gestionar las visitas de reposición de Grupo Solvens en supermercados. Cubre todo el circuito: el repositor registra la visita desde el celular con el stock relevado y fotos de la góndola, administración controla y aprueba esa evidencia, el supervisor sigue lo que pasa en su zona y la marca ve el resultado en las sucursales donde se reponen sus productos.

## El problema que resuelve

Antes, la evidencia de cada visita (fotos, estado del stock, qué sucursal y qué día) circulaba de forma dispersa y los reportes para cada marca se armaban a mano. El sistema centraliza esa información, la valida en el momento de la carga y genera los reportes de forma automática.

## Qué hace cada perfil

### Repositor

Es quien está en la sucursal. Su vista está pensada para usarse rápido desde el celular.

- **Carga de visita:** elige el cliente (la marca) y la sucursal. Solo ve las sucursales de su zona que abastece ese cliente, así no puede cargar una visita en un lugar que no le corresponde. El backend vuelve a validar la zona aunque se intente forzar desde el navegador.
- **Relevamiento de stock:** para cada categoría de producto del cliente marca el estado del stock con botones de colores (los tipos de stock son configurables). El sistema no deja enviar la visita hasta completar todas las categorías.
- **Góndola:** para las categorías que lo requieren, indica si el producto está en góndola y se guarda ese dato junto al stock.
- **Fotos:** sube la evidencia de la visita, hasta 3 o 5 fotos según el cliente. Las fotos se procesan automáticamente: se enderezan según la orientación del teléfono, se redimensionan y se comprimen antes de guardarse. Si llega una foto en formato HEIC (iPhone) que no se puede convertir, el sistema muestra un mensaje claro que explica cómo resolverlo.
- **Mis visitas del mes:** consulta lo que cargó en el mes y el estado de cada visita.

### Supervisor

- Ve las fotos y visitas de las combinaciones de **zona y cliente** que tiene asignadas, sin acceso al resto.
- Visor con filtros para revisar rápidamente qué se hizo en cada sucursal de su zona.

### Administrador

Es el panel central de control.

- **Gestión de visitas:** listado de visitas pendientes para aprobar o rechazar, y eliminación de visitas cargadas por error.
- **Evidencia de visita:** revisa cada foto, la aprueba, la rechaza o la rota si quedó mal orientada. Solo las fotos aprobadas llegan al cliente.
- **Reporte de visitas y de productos:** tablas con filtros multiselección en cascada por zona, subzona, región, cadena, sucursal, cliente, repositor y rango de fechas, con buscador.
- **Visitas por semana por cliente:** muestra la frecuencia con la que se visitó cada sucursal de un cliente, por semana y por zona.
- **Carga de imágenes por cliente:** controla en qué sucursales se cargó evidencia y en cuáles falta, con exportación a Excel.
- **Exportación a PowerPoint:** genera automáticamente la presentación para cada cliente, con portada, una diapositiva por punto de venta (cadena y dirección) y las fotos aprobadas acomodadas según la cantidad.
- **Reporte de categorías en Excel:** planilla con el estado del stock por categoría en cada sucursal, con columna de zona y colores según el estado.
- **ABM completo:** usuarios y tipos de usuario, cadenas y tipos de cadena, sucursales (puntos de venta), categorías y productos.
- **Asignaciones:** zona de cada usuario y qué clientes se reponen en qué sucursal (abastecimiento).

### Cliente (la marca)

- **Evidencia de visita:** ve las fotos aprobadas de la última visita a cada sucursal donde se reponen sus productos, en un visor con zoom y desplazamiento.
- **Mis reportes:** tabla con las visitas realizadas a sus sucursales.

## Reglas de negocio destacadas

- **Visibilidad por zona:** cada usuario trabaja solo sobre su zona. GBA y CABA comparten visibilidad entre sí (subzonas Sur, Oeste, Norte y Capital Federal).
- **Límite de fotos por cliente:** 5 para los clientes que lo requieren, 3 para el resto.
- **Circuito de aprobación:** toda foto y toda visita pasan por Pendiente, Aprobado o Rechazado antes de ser visibles para el cliente.
- **Contraseñas con bcrypt:** las contraseñas viejas guardadas en texto plano se migran automáticamente a hash la primera vez que el usuario inicia sesión.

## Stack

- **Frontend:** HTML, CSS y JavaScript sin frameworks, una página por vista
- **Backend:** Node.js con Express 5 (ES Modules)
- **Base de datos:** PostgreSQL (`pg`)
- **Almacenamiento de imágenes:** Cloudflare R2 a través de la API de S3 (`@aws-sdk/client-s3`)
- **Procesamiento de imágenes:** `multer` (en memoria) y `sharp`
- **Reportes:** `pptxgenjs` para PowerPoint y SheetJS para Excel

## Estructura

```
GrupoSolvens/
├── package.json
├── IMG/                      Imágenes locales (logo e imágenes heredadas)
└── CODIGO/
    ├── *.html                Una página por vista (login, inicio por perfil, ABM, reportes, fotos)
    ├── js/
    │   ├── server.mjs        API REST y servidor de archivos estáticos
    │   ├── conexion.mjs      Pool de conexiones a PostgreSQL
    │   ├── filtros.js        Lógica de filtros compartida
    │   └── modal_confirmacion.js
    └── style/                Hojas de estilo por sección (shared.css es la base)
```

## Modelo de datos

| Tabla | Contenido |
|---|---|
| `usuario`, `tipo_usuario` | Usuarios de los cuatro perfiles y su zona asignada |
| `zona`, `subzona` | División geográfica que define qué ve cada usuario |
| `cadena`, `tipo_cadena` | Cadenas de supermercados |
| `sucursal` | Puntos de venta, con dirección, cadena y subzona |
| `abastece` | Qué cliente se repone en qué sucursal |
| `supervisa` | Qué zonas y clientes ve cada supervisor |
| `categoria`, `producto`, `tipo_stock` | Catálogo por cliente y estados de stock posibles |
| `visita`, `visita_stock` | Cada visita y el stock relevado por categoría |
| `imagen` | Fotos de cada visita, con su estado de aprobación y rotación |

## Equipo

Patricio Altamiranda, [@melitroncoso](https://github.com/melitroncoso), MatyBotta / Matías Bottarini y colaboradores.

## Licencia

Uso privado de Grupo Solvens. Todos los derechos reservados.
