import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import bcrypt from 'bcrypt';
import https from 'https';
import http from 'http';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import PptxGenJS from 'pptxgenjs';
import { query, getClient } from './conexion.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, '..')));
app.use('/IMG', express.static(path.join(__dirname, '..', '..', 'IMG')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'login.html'));
});

// ── R2 CLIENT ───────────────────────────────────────────────────────────────
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const R2_BUCKET   = process.env.R2_BUCKET_NAME;
const R2_BASE_URL = process.env.R2_PUBLIC_URL; // ej: https://pub-xxx.r2.dev

async function subirImagenR2(buffer, nombreArchivo) {
    const comprimido = await sharp(buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: nombreArchivo,
        Body: comprimido,
        ContentType: 'image/jpeg',
    }));

    return `${R2_BASE_URL}/${nombreArchivo}`;
}

// ── MULTER (memoria, sin guardar en disco) ────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }
});


// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS DE ZONA
// ═══════════════════════════════════════════════════════════════════════════════

// IDs de zona que comparten visibilidad total entre si.
// Zona 1 = GBA, Zona 2 = CABA. Los repositores de cualquiera de estas dos zonas
// ven sucursales de ambas (subzonas 1=Sur, 2=Oeste, 3=Norte, 4=Capital Federal).
const ZONAS_COMPARTIDAS = [1, 2];

// Devuelve los IDs de zona que un repositor puede ver.
// Si su zona esta en ZONAS_COMPARTIDAS, puede ver todas las zonas del grupo.
// Si no tiene zona asignada, devuelve tieneZona=false (sin acceso).
async function obtenerZonasPermitidas(id_repo) {
    const result = await query(
        `SELECT id_zona FROM usuario WHERE id = $1`,
        [id_repo]
    );

    if (result.rows.length === 0) return { zonasIds: [], tieneZona: false };

    const { id_zona } = result.rows[0];

    if (!id_zona) return { zonasIds: [], tieneZona: false };

    // Si el repositor pertenece a zona 1 o 2, ve sucursales de ambas zonas
    if (ZONAS_COMPARTIDAS.includes(id_zona)) {
        return { zonasIds: ZONAS_COMPARTIDAS, tieneZona: true };
    }

    return { zonasIds: [id_zona], tieneZona: true };
}

// Construye el fragmento SQL "AND sz.id_zona IN ($n, $n+1, ...)"
// para insertar en queries que ya tienen parámetros previos.
function buildZonaClause(zonasIds, startIdx) {
    if (zonasIds.length === 0) return { clause: 'AND 1=0', params: [] }; // sin acceso
    const placeholders = zonasIds.map((_, i) => `$${startIdx + i}`).join(', ');
    return {
        clause: `AND sz.id_zona IN (${placeholders})`,
        params: zonasIds,
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// CADENAS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/tipos-cadena', async (req, res, next) => {
    try {
        const result = await query('SELECT id AS "ID", tipo AS "Tipo" FROM tipo_cadena');
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/cadenas', async (req, res, next) => {
    try {
        const result = await query('SELECT id AS "ID", nombre AS "Nombre" FROM cadena');
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.post('/api/agregar-cadena', async (req, res, next) => {
    const { nombre, tipo } = req.body;
    try {
        const existe = await query('SELECT 1 FROM cadena WHERE nombre = $1', [nombre]);
        if (existe.rows.length > 0)
            return res.status(400).json({ success: false, message: `La cadena "${nombre}" ya está registrada.` });

        const tipoRow = await query('SELECT id FROM tipo_cadena WHERE tipo = $1', [tipo]);
        if (tipoRow.rows.length === 0)
            return res.status(400).json({ success: false, message: 'Tipo de cadena no encontrado.' });

        await query('INSERT INTO cadena (nombre, id_tipo) VALUES ($1, $2)', [nombre, tipoRow.rows[0].id]);
        res.json({ success: true, message: 'Cadena guardada correctamente' });
    } catch (e) { next(e); }
});

app.delete('/api/eliminar-cadena/:id', async (req, res, next) => {
    try {
        const result = await query('DELETE FROM cadena WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0)
            return res.status(404).json({ success: false, message: 'No existe' });
        res.json({ success: true, message: 'Cadena y sucursales eliminadas' });
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// SUCURSALES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/subzonas', async (req, res, next) => {
    try {
        const result = await query('SELECT id AS "ID", nombre AS "Nombre" FROM subzona');
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/buscar-sucursales', async (req, res, next) => {
    const { id_cadena, id_subzona } = req.query;
    try {
        let sql = 'SELECT id AS "ID", calle AS "Calle", altura AS "Altura", localidad AS "Localidad" FROM sucursal WHERE id_cadena = $1';
        const params = [id_cadena];

        if (id_subzona && id_subzona !== 'undefined' && id_subzona !== 'null' && id_subzona !== '') {
            sql += ' AND id_subzona = $2';
            params.push(id_subzona);
        }

        const result = await query(sql, params);
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.post('/api/agregar-sucursal', async (req, res, next) => {
    const { calle, altura, localidad, id_subzona, id_cadena } = req.body;
    try {
        const existe = await query(
            'SELECT id FROM sucursal WHERE calle = $1 AND altura = $2 AND id_cadena = $3',
            [calle, altura, id_cadena]
        );
        if (existe.rows.length > 0)
            return res.status(400).json({ success: false, message: 'Ya registrada' });

        await query(
            'INSERT INTO sucursal (calle, altura, localidad, id_subzona, id_cadena) VALUES ($1,$2,$3,$4,$5)',
            [calle, altura, localidad, id_subzona, id_cadena]
        );
        res.json({ success: true, message: 'Sucursal guardada' });
    } catch (e) { next(e); }
});

app.delete('/api/eliminar-sucursal/:id', async (req, res, next) => {
    try {
        await query('DELETE FROM sucursal WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Eliminada correctamente' });
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// TIPOS DE USUARIO
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/tipos-usuario', async (req, res, next) => {
    try {
        const result = await query('SELECT id, tipo FROM tipo_usuario');
        res.json(result.rows);
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// USUARIOS
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/crear-usuario', async (req, res, next) => {
    const { nombre, id_tipo, mail, usuario, clave, sucursalesIds, id_zona } = req.body;
    const client = await getClient();
    try {
        // Verificar si el tipo es repositor para validar zona obligatoria
        const tipoRow = await client.query(
            'SELECT tipo FROM tipo_usuario WHERE id = $1', [id_tipo]
        );
        if (tipoRow.rows.length === 0)
            return res.status(400).json({ success: false, message: 'Tipo de usuario inválido.' });

        const esRepositor = tipoRow.rows[0].tipo.toLowerCase() === 'repositor';

        if (esRepositor && !id_zona) {
            return res.status(400).json({ success: false, message: 'Los repositores deben tener una zona asignada.' });
        }

        // Verificar duplicado
        const existe = await client.query(
            'SELECT usuario, mail FROM usuario WHERE usuario = $1 OR mail = $2',
            [usuario, mail]
        );
        if (existe.rows.length > 0) {
            const dup = existe.rows[0];
            let msg = 'El registro ya existe.';
            if (dup.usuario === usuario) msg = 'El nombre de usuario ya está en uso.';
            else if (dup.mail === mail)  msg = 'El correo electrónico ya está registrado.';
            return res.status(400).json({ success: false, message: msg });
        }

        const hashedPass = await bcrypt.hash(clave, 10);

        await client.query('BEGIN');

        const userRes = await client.query(
            `INSERT INTO usuario (nombre, id_tipo_usuario, mail, usuario, clave, id_zona)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [nombre, id_tipo, mail, usuario, hashedPass, id_zona || null]
        );
        const newUserId = userRes.rows[0].id;

        if (sucursalesIds && sucursalesIds.length > 0) {
            for (const sId of sucursalesIds) {
                await client.query(
                    'INSERT INTO abastece (id_cliente, id_sucursal) VALUES ($1,$2)',
                    [newUserId, sId]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Usuario y asignaciones creados con éxito.' });
    } catch (e) {
        await client.query('ROLLBACK');
        next(e);
    } finally {
        client.release();
    }
});

app.get('/api/usuarios', async (req, res, next) => {
    const { tipo } = req.query;
    try {
        const result = await query(
            'SELECT id AS "ID", nombre AS "Nombre" FROM usuario WHERE id_tipo_usuario = $1', [tipo]
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/buscar-usuarios-eliminar', async (req, res, next) => {
    const { q } = req.query;
    try {
        const result = await query(
            `SELECT u.id AS "ID", u.nombre AS "Nombre", u.usuario AS "Usuario", t.tipo AS "Tipo"
             FROM usuario u JOIN tipo_usuario t ON u.id_tipo_usuario = t.id
             WHERE u.nombre ILIKE $1 OR u.usuario ILIKE $1`,
            [`%${q}%`]
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.delete('/api/eliminar-usuario/:id', async (req, res, next) => {
    try {
        await query('DELETE FROM usuario WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Usuario eliminado con éxito.' });
    } catch (e) { next(e); }
});

// Clientes activos (tipo = 'Cliente')
app.get('/api/clientes-activos', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT u.id AS "ID", u.nombre AS "Nombre"
             FROM usuario u
             JOIN tipo_usuario t ON u.id_tipo_usuario = t.id
             WHERE t.tipo = 'Cliente'
             ORDER BY u.nombre`
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/login', async (req, res, next) => {
    const { user, password } = req.body;
    try {
        const result = await query(
            'SELECT id, nombre, id_tipo_usuario AS tipo, clave FROM usuario WHERE usuario = $1',
            [user]
        );
        if (result.rows.length === 0)
            return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });

        const userRec = result.rows[0];
        let match = false;

        if (userRec.clave && userRec.clave.startsWith('$2')) {
            match = await bcrypt.compare(password, userRec.clave);
        } else {
            match = (password === userRec.clave);
        }

        if (!match)
            return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });

        // Re-hashear contraseñas legacy
        if (!(userRec.clave && userRec.clave.startsWith('$2'))) {
            const hashed = await bcrypt.hash(password, 10);
            await query('UPDATE usuario SET clave = $1 WHERE id = $2', [hashed, userRec.id]);
        }

        res.json({ success: true, id: userRec.id, tipo: userRec.tipo, nombre: userRec.nombre });
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/categorias', async (req, res, next) => {
    try {
        const result = await query('SELECT id AS "ID", categoria AS "Categoria" FROM categoria');
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/buscar-categorias', async (req, res, next) => {
    const { q } = req.query;
    try {
        const result = await query(
            'SELECT id AS "ID", categoria AS "Categoria" FROM categoria WHERE categoria ILIKE $1', [`%${q}%`]
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.post('/api/agregar-categoria', async (req, res, next) => {
    const { categoria } = req.body;
    try {
        const existe = await query('SELECT 1 FROM categoria WHERE categoria = $1', [categoria]);
        if (existe.rows.length > 0)
            return res.status(400).json({ success: false, message: 'La categoría ya existe.' });

        await query('INSERT INTO categoria (categoria) VALUES ($1)', [categoria]);
        res.json({ success: true, message: 'Categoría creada con éxito.' });
    } catch (e) { next(e); }
});

app.delete('/api/eliminar-categoria/:id', async (req, res, next) => {
    try {
        await query('DELETE FROM categoria WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Categoría eliminada.' });
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/agregar-producto', async (req, res, next) => {
    const { id_cliente, descripcion, id_categoria, sku } = req.body;
    try {
        await query(
            'INSERT INTO producto (id_cliente, descripcion, id_categoria, sku) VALUES ($1,$2,$3,$4)',
            [id_cliente, descripcion, id_categoria, sku]
        );
        res.json({ success: true, message: 'Producto registrado con éxito.' });
    } catch (e) { next(e); }
});

app.get('/api/buscar-productos', async (req, res, next) => {
    const { q } = req.query;
    try {
        const result = await query(
            `SELECT p.id AS "ID", p.descripcion AS "Descripcion", p.sku AS "SKU", u.nombre AS "Cliente"
             FROM producto p JOIN usuario u ON p.id_cliente = u.id
             WHERE p.descripcion ILIKE $1 OR p.sku ILIKE $1`,
            [`%${q}%`]
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.delete('/api/eliminar-producto/:id', async (req, res, next) => {
    try {
        await query('DELETE FROM producto WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Producto eliminado correctamente.' });
    } catch (e) { next(e); }
});

app.get('/api/productos-cliente', async (req, res, next) => {
    const { id_cliente } = req.query;
    try {
        const result = await query(
            'SELECT id AS "ID", descripcion AS "Descripcion" FROM producto WHERE id_cliente = $1', [id_cliente]
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// SUCURSALES DE UN CLIENTE
// ═══════════════════════════════════════════════════════════════════════════════

// El repositor se identifica por id_repo (viene del localStorage en el frontend).
// La zona del repositor se lee siempre desde BD — nunca se confía en el frontend.
app.get('/api/mis-sucursales', async (req, res, next) => {
    const { id_cliente, id_repo } = req.query;

    // Sin id_repo = llamada de admin, devuelve todas las sucursales del cliente sin filtro de zona
    if (!id_repo) {
        try {
            const result = await query(
                `SELECT s.id AS "ID", s.calle AS "Calle", s.altura AS "Altura",
                        s.localidad AS "Localidad", ca.nombre AS "Cadena"
                 FROM sucursal s
                 JOIN abastece a  ON s.id = a.id_sucursal
                 JOIN cadena ca   ON s.id_cadena = ca.id
                 WHERE a.id_cliente = $1`,
                [id_cliente]
            );
            return res.json(result.rows);
        } catch (e) { return next(e); }
    }

    try {
        const { zonasIds, tieneZona } = await obtenerZonasPermitidas(id_repo);

        if (!tieneZona) {
            return res.status(403).json({ error: 'El repositor no tiene zona asignada.' });
        }

        const { clause, params } = buildZonaClause(zonasIds, 2); // $1 = id_cliente

        const result = await query(
            `SELECT s.id AS "ID", s.calle AS "Calle", s.altura AS "Altura", s.localidad AS "Localidad",
                    ca.nombre AS "Cadena"
             FROM sucursal s
             JOIN abastece a  ON s.id = a.id_sucursal
             JOIN subzona sz  ON s.id_subzona = sz.id
             JOIN cadena ca   ON s.id_cadena = ca.id
             WHERE a.id_cliente = $1
             ${clause}`,
            [id_cliente, ...params]
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.put('/api/actualizar-abastece', async (req, res, next) => {
    const { id_cliente, sucursalesIds } = req.body;
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM abastece WHERE id_cliente = $1', [id_cliente]);
        for (const sId of sucursalesIds) {
            await client.query(
                'INSERT INTO abastece (id_cliente, id_sucursal) VALUES ($1,$2)', [id_cliente, sId]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        next(e);
    } finally {
        client.release();
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
// CARGAR VISITA (con imágenes → R2)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/cargar-visita', upload.array('imagenes', 5), async (req, res, next) => {
    const { id_repo, id_cliente, id_sucursal, productos } = req.body;
    if (!productos) return res.status(400).json({ success: false, error: 'No hay productos' });

    const listaProd = JSON.parse(productos);
    const client = await getClient();

    try {
        // Validar que la sucursal pertenece a la zona del repositor (validación backend obligatoria)
        const { zonasIds, tieneZona } = await obtenerZonasPermitidas(id_repo);

        if (!tieneZona) {
            return res.status(403).json({ success: false, error: 'El repositor no tiene zona asignada.' });
        }

        const { clause, params: zonaParams } = buildZonaClause(zonasIds, 2); // $1 = id_sucursal

        const sucursalCheck = await query(
            `SELECT s.id FROM sucursal s
             JOIN subzona sz ON s.id_subzona = sz.id
             WHERE s.id = $1
             ${clause}`,
            [id_sucursal, ...zonaParams]
        );

        if (sucursalCheck.rows.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'La sucursal seleccionada no pertenece a tu zona asignada.'
            });
        }

        // Validar límite de fotos según cliente (AGD = 5, resto = 3)
        const clienteRow = await query(`SELECT nombre FROM usuario WHERE id = $1`, [id_cliente]);
        const nombreCliente = clienteRow.rows[0]?.nombre?.toUpperCase() || '';
        const maxFotos = nombreCliente.includes('AGD') ? 5 : 3;

        if (req.files && req.files.length > maxFotos) {
            return res.status(400).json({
                success: false,
                error: `Solo se permiten ${maxFotos} foto${maxFotos > 1 ? 's' : ''} para este cliente.`
            });
        }

        await client.query('BEGIN');

        // A. Insertar visita
        const vRes = await client.query(
            `INSERT INTO visita (fecha, id_repo, id_cliente, id_sucursal)
             VALUES (CURRENT_DATE, $1, $2, $3) RETURNING id`,
            [id_repo, id_cliente, id_sucursal]
        );
        const vId = vRes.rows[0].id;

        // B. Insertar cargas de productos
        for (const p of listaProd) {
            await client.query(
                `INSERT INTO carga (precio, id_producto, id_visita, estado, oferta)
                 VALUES ($1,$2,$3,'Pendiente',$4)`,
                [p.precio, p.id_prod, vId, p.oferta ? true : false]
            );
        }

        // C. Subir imágenes a R2
        if (req.files && req.files.length > 0) {
            const fechaHoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            for (const f of req.files) {
                const nroRandom = Math.floor(10000 + Math.random() * 90000);
                const nombreArchivo = `${fechaHoy}_${vId}_${nroRandom}.jpg`;
                const urlPublica = await subirImagenR2(f.buffer, nombreArchivo);

                await client.query(
                    'INSERT INTO imagen (ruta_imagen, id_visita, estado) VALUES ($1,$2,$3)',
                    [urlPublica, vId, nombreCliente.includes('DEL VALLE') ? 'Aprobado' : 'Pendiente']
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Visita y productos guardados' });
    } catch (e) {
        await client.query('ROLLBACK');
        next(e);
    } finally {
        client.release();
    }
});


// ═══════════════════════════════════════════════════════════════════════════════
// IMÁGENES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/imagenes-aprobadas-cliente', async (req, res, next) => {
    const { id_cliente, latest } = req.query;
    if (!id_cliente) return res.status(400).json({ error: 'Falta id_cliente' });
    try {
        const check = await query(
            `SELECT id FROM usuario WHERE id = $1
             AND id_tipo_usuario = (SELECT id FROM tipo_usuario WHERE tipo = 'Cliente')`,
            [id_cliente]
        );
        if (check.rows.length === 0)
            return res.status(403).json({ error: 'Acceso no autorizado' });

        let sql;
        if (latest === '1') {
            sql = `
                WITH latest_visits AS (
                    SELECT v.id AS id_visita_row, v.id_sucursal,
                           ROW_NUMBER() OVER (PARTITION BY v.id_sucursal ORDER BY v.fecha DESC, v.id DESC) AS rn
                    FROM visita v
                    WHERE v.id_cliente = $1
                      AND EXISTS (SELECT 1 FROM imagen im WHERE im.id_visita = v.id AND im.estado = 'Aprobado')
                )
                SELECT v.id AS "idVisita", v.fecha AS "Fecha",
                       urepo.nombre AS "Repositor", ca.nombre AS "Cadena",
                       s.localidad AS "Localidad",
                       s.calle || ' ' || COALESCE(CAST(s.altura AS VARCHAR),'') AS "Sucursal",
                       sz.nombre AS "SubzonaNombre", z.nombre AS "ZonaNombre",
                       tc.tipo AS "CanalTipo",
                       im.id AS "idImagen", im.ruta_imagen AS "Ruta_Imagen", im.estado AS "EstadoImagen"
                FROM latest_visits lv
                JOIN visita v      ON lv.id_visita_row = v.id
                JOIN usuario urepo ON v.id_repo = urepo.id
                JOIN sucursal s    ON v.id_sucursal = s.id
                JOIN cadena ca     ON s.id_cadena = ca.id
                LEFT JOIN subzona sz ON s.id_subzona = sz.id
                LEFT JOIN zona z     ON sz.id_zona = z.id
                LEFT JOIN tipo_cadena tc ON ca.id_tipo = tc.id
                JOIN imagen im     ON im.id_visita = v.id
                WHERE lv.rn = 1 AND im.estado = 'Aprobado'
                ORDER BY v.fecha DESC, v.id DESC`;
        } else {
            sql = `
                SELECT v.id AS "idVisita", v.fecha AS "Fecha",
                       urepo.nombre AS "Repositor", ca.nombre AS "Cadena",
                       s.localidad AS "Localidad",
                       s.calle || ' ' || COALESCE(CAST(s.altura AS VARCHAR),'') AS "Sucursal",
                       sz.nombre AS "SubzonaNombre", z.nombre AS "ZonaNombre",
                       tc.tipo AS "CanalTipo",
                       im.id AS "idImagen", im.ruta_imagen AS "Ruta_Imagen", im.estado AS "EstadoImagen"
                FROM visita v
                JOIN usuario urepo ON v.id_repo = urepo.id
                JOIN sucursal s    ON v.id_sucursal = s.id
                JOIN cadena ca     ON s.id_cadena = ca.id
                LEFT JOIN subzona sz ON s.id_subzona = sz.id
                LEFT JOIN zona z     ON sz.id_zona = z.id
                LEFT JOIN tipo_cadena tc ON ca.id_tipo = tc.id
                JOIN imagen im     ON im.id_visita = v.id
                WHERE v.id_cliente = $1 AND im.estado = 'Aprobado'
                ORDER BY v.fecha DESC, v.id DESC`;
        }

        const result = await query(sql, [id_cliente]);
        const grouped = {};
        const finalArray = [];
        const seen = new Set();

        result.rows.forEach(r => {
            if (!grouped[r.idVisita]) {
                grouped[r.idVisita] = {
                    id: r.idVisita, fecha: r.Fecha, repositor: r.Repositor,
                    cadena: r.Cadena, localidad: r.Localidad, sucursal: r.Sucursal,
                    subzona: r.SubzonaNombre, zona: r.ZonaNombre, canal: r.CanalTipo,
                    imagenes: []
                };
            }
            grouped[r.idVisita].imagenes.push({ id: r.idImagen, ruta: r.Ruta_Imagen, estado: r.EstadoImagen });
            if (!seen.has(r.idVisita)) { finalArray.push(grouped[r.idVisita]); seen.add(r.idVisita); }
        });

        res.json(finalArray);
    } catch (e) { next(e); }
});

app.get('/api/imagenes-visitas', async (req, res, next) => {
    try {
        const result = await query(`
            SELECT v.id AS "idVisita", v.fecha AS "Fecha",
                   urepo.nombre AS "Repositor", ucli.nombre AS "Cliente",
                   ca.nombre AS "Cadena", s.localidad AS "Localidad",
                   s.calle || ' ' || COALESCE(CAST(s.altura AS VARCHAR),'') AS "Sucursal",
                   sz.nombre AS "SubzonaNombre", z.nombre AS "ZonaNombre",
                   tc.tipo AS "CanalTipo",
                   im.id AS "idImagen", im.ruta_imagen AS "Ruta_Imagen",
                   im.estado AS "EstadoImagen", c.estado AS "EstadoCarga"
            FROM visita v
            JOIN usuario urepo   ON v.id_repo = urepo.id
            JOIN usuario ucli    ON v.id_cliente = ucli.id
            JOIN sucursal s      ON v.id_sucursal = s.id
            JOIN cadena ca       ON s.id_cadena = ca.id
            LEFT JOIN subzona sz ON s.id_subzona = sz.id
            LEFT JOIN zona z     ON sz.id_zona = z.id
            LEFT JOIN tipo_cadena tc ON ca.id_tipo = tc.id
            JOIN imagen im       ON im.id_visita = v.id
            LEFT JOIN carga c    ON c.id_visita = v.id
            WHERE v.fecha >= CURRENT_DATE - INTERVAL '15 days'
            ORDER BY v.fecha DESC
        `);

        const grouped = {};
        result.rows.forEach(r => {
            if (!grouped[r.idVisita]) {
                grouped[r.idVisita] = {
                    id: r.idVisita, fecha: r.Fecha, repositor: r.Repositor,
                    cliente: r.Cliente, cadena: r.Cadena, localidad: r.Localidad,
                    sucursal: r.Sucursal, subzona: r.SubzonaNombre, zona: r.ZonaNombre,
                    canal: r.CanalTipo, estadoCarga: r.EstadoCarga || 'Pendiente',
                    imagenes: []
                };
            }
            grouped[r.idVisita].imagenes.push({
                id: r.idImagen, ruta: r.Ruta_Imagen, estado: r.EstadoImagen || 'Pendiente'
            });
        });
        res.json(Object.values(grouped));
    } catch (e) { next(e); }
});

app.patch('/api/imagen/:id/estado', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { estado, rotacion } = req.body;
    const valid = ['Pendiente', 'Aprobado', 'Rechazado'];
    if (isNaN(id) || !valid.includes(estado))
        return res.status(400).json({ success: false, message: 'ID o estado inválido' });
    try {
        const check = await query('SELECT ruta_imagen FROM imagen WHERE id = $1', [id]);
        if (check.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Imagen no encontrada' });

        if (estado === 'Aprobado' && rotacion && rotacion > 0) {
            const url = check.rows[0].ruta_imagen;
            const filename = url.substring(url.lastIndexOf('/') + 1);
            try {
                const imgRes = await fetch(url);
                if (imgRes.ok) {
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const rotadoBuffer = await sharp(Buffer.from(arrayBuffer)).rotate(rotacion).jpeg({ quality: 80 }).toBuffer();
                    await r2.send(new PutObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: filename,
                        Body: rotadoBuffer,
                        ContentType: 'image/jpeg',
                    }));
                }
            } catch (err) {
                console.error("Error al rotar imagen en R2:", err);
            }
        }

        await query('UPDATE imagen SET estado = $1 WHERE id = $2', [estado, id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.get('/api/exportar-ppt', async (req, res, next) => {
    const { cliente } = req.query;
    if (!cliente) return res.status(400).json({ error: 'Cliente requerido' });

    try {
        // Obtener id_cliente
        const clienteResult = await query('SELECT id FROM usuario WHERE nombre = $1', [cliente]);
        if (clienteResult.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        const idCliente = clienteResult.rows[0].id;

        // Obtener sucursales que abastece el cliente
        const sucursales = await query(`
            SELECT s.id, s.calle, s.altura, s.localidad, ca.nombre AS cadena
            FROM abastece a
            JOIN sucursal s ON a.id_sucursal = s.id
            JOIN cadena ca ON s.id_cadena = ca.id
            WHERE a.id_cliente = $1
        `, [idCliente]);

        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in

        const C_ROJO   = 'DC2626';
        const C_NEGRO  = '111111';
        const C_BLANCO = 'FFFFFF';
        const C_GRIS   = '999999';

        // ── Slide de portada ──────────────────────────────────────────────────
        const portada = pptx.addSlide();
        portada.background = { color: C_NEGRO };
        portada.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.08, fill: { color: C_ROJO }, line: { color: C_ROJO } });
        portada.addShape(pptx.ShapeType.rect, { x: 0, y: 7.42, w: '100%', h: 0.08, fill: { color: C_ROJO }, line: { color: C_ROJO } });
        portada.addText('EVIDENCIA FOTOGRÁFICA', {
            x: 0, y: 2.2, w: '100%', align: 'center',
            fontSize: 40, bold: true, color: C_BLANCO, fontFace: 'Segoe UI'
        });
        portada.addText(cliente.toUpperCase(), {
            x: 0, y: 3.1, w: '100%', align: 'center',
            fontSize: 28, bold: true, color: C_ROJO, fontFace: 'Segoe UI'
        });
        portada.addText(new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).toUpperCase(), {
            x: 0, y: 3.85, w: '100%', align: 'center',
            fontSize: 14, color: C_GRIS, fontFace: 'Segoe UI'
        });
        portada.addText('Grupo Solvens', {
            x: 0, y: 6.9, w: '100%', align: 'center',
            fontSize: 11, color: C_GRIS, fontFace: 'Segoe UI'
        });

        // ── Layouts de imágenes (en pulgadas, slide 13.33 x 7.5) ─────────────
        const MARGIN = 0.18;
        const Y_TOP  = 0.72; // debajo del header
        const H_DISP = 6.6;  // alto disponible
        const W_DISP = 13.33 - MARGIN * 2;

        const LAYOUTS = {
            1: [{ x: MARGIN, y: Y_TOP, w: W_DISP, h: H_DISP }],
            2: [
                { x: MARGIN,            y: Y_TOP, w: (W_DISP - 0.12) / 2, h: H_DISP },
                { x: MARGIN + (W_DISP - 0.12) / 2 + 0.12, y: Y_TOP, w: (W_DISP - 0.12) / 2, h: H_DISP }
            ],
            3: [
                { x: MARGIN, y: Y_TOP,             w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + (W_DISP - 0.12) / 2 + 0.12, y: Y_TOP, w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + W_DISP / 4, y: Y_TOP + (H_DISP - 0.12) / 2 + 0.12, w: W_DISP / 2, h: (H_DISP - 0.12) / 2 }
            ],
            4: [
                { x: MARGIN,            y: Y_TOP,             w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + (W_DISP - 0.12) / 2 + 0.12, y: Y_TOP,             w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN,            y: Y_TOP + (H_DISP - 0.12) / 2 + 0.12, w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + (W_DISP - 0.12) / 2 + 0.12, y: Y_TOP + (H_DISP - 0.12) / 2 + 0.12, w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 }
            ],
            5: [
                { x: MARGIN,             y: Y_TOP,                       w: (W_DISP - 0.24) / 3, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + (W_DISP - 0.24) / 3 + 0.12,             y: Y_TOP,                       w: (W_DISP - 0.24) / 3, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + ((W_DISP - 0.24) / 3 + 0.12) * 2,       y: Y_TOP,                       w: (W_DISP - 0.24) / 3, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + (W_DISP - 0.24) / 4 * 0.5, y: Y_TOP + (H_DISP - 0.12) / 2 + 0.12, w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 },
                { x: MARGIN + (W_DISP - 0.12) / 2 + 0.12 + (W_DISP - 0.24) / 4 * 0.5, y: Y_TOP + (H_DISP - 0.12) / 2 + 0.12, w: (W_DISP - 0.12) / 2, h: (H_DISP - 0.12) / 2 }
            ]
        };

        for (const suc of sucursales.rows) {
            // Obtener última visita aprobada a esta sucursal por este cliente
            const visitaResult = await query(`
                SELECT v.id, v.fecha, u.nombre AS repositor
                FROM visita v
                JOIN usuario u ON v.id_repo = u.id
                WHERE v.id_cliente = $1 AND v.id_sucursal = $2
                AND EXISTS (SELECT 1 FROM imagen im WHERE im.id_visita = v.id AND im.estado = 'Aprobado')
                ORDER BY v.fecha DESC LIMIT 1
            `, [idCliente, suc.id]);

            if (visitaResult.rows.length === 0) continue;

            const visita = visitaResult.rows[0];

            // Obtener imágenes aprobadas (máximo 5)
            const imagenes = await query(`
                SELECT ruta_imagen FROM imagen WHERE id_visita = $1 AND estado = 'Aprobado' LIMIT 5
            `, [visita.id]);

            if (imagenes.rows.length === 0) continue;

            // ── Crear slide ───────────────────────────────────────────────────
            const slide = pptx.addSlide();
            slide.background = { color: C_NEGRO };

            // Franja roja superior
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.62, fill: { color: C_ROJO }, line: { color: C_ROJO } });

            // Cadena + dirección (izquierda del header)
            slide.addText(`${suc.cadena.toUpperCase()}  —  ${suc.calle} ${suc.altura || ''}, ${suc.localidad}`, {
                x: 0.2, y: 0, w: 8.5, h: 0.62,
                fontSize: 15, bold: true, color: C_BLANCO, fontFace: 'Segoe UI', valign: 'middle'
            });

            // Fecha + repositor (derecha del header)
            slide.addText(`${new Date(visita.fecha).toLocaleDateString('es-AR')}  ·  ${visita.repositor}`, {
                x: 8.8, y: 0, w: 4.33, h: 0.62,
                fontSize: 11, color: C_BLANCO, fontFace: 'Segoe UI', align: 'right', valign: 'middle'
            });

            // ── Imágenes con layout adaptativo ───────────────────────────────
            const count = Math.min(imagenes.rows.length, 5);
            const positions = LAYOUTS[count];

            for (let i = 0; i < count; i++) {
                const img = imagenes.rows[i];
                try {
                    const imgRes = await fetch(img.ruta_imagen);
                    if (!imgRes.ok) continue;

                    // Detectar tipo real de imagen para evitar XML inválido en el PPTX
                    const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
                    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    const mimeType = tiposPermitidos.includes(ct) ? ct : 'image/jpeg';

                    const buf = Buffer.from(await imgRes.arrayBuffer());
                    if (buf.length === 0) continue;

                    const pos = positions[i];
                    slide.addImage({
                        data: `data:${mimeType};base64,${buf.toString('base64')}`,
                        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
                        sizing: { type: 'contain', w: pos.w, h: pos.h }
                    });
                } catch (err) {
                    console.error('Error al obtener imagen:', err);
                }
            }
        }

        const buffer = await pptx.write({ outputType: 'nodebuffer' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="Evidencia_${cliente}.pptx"`);
        res.send(buffer);
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// VISITAS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/visitas', async (req, res, next) => {
    const { fecha_desde, fecha_hasta, id_cadena, id_sucursal, id_cliente } = req.query;
    try {
        let sql = `
            SELECT v.id AS "ID_Visita", v.fecha AS "Fecha",
                   COALESCE(urepo.nombre, 'Sin Repositor') AS "Repositor",
                   COALESCE(ca.nombre, 'S/C') || ' - ' || COALESCE(s.calle, 'S/N') AS "Sucursal",
                   COALESCE(ucli.nombre, 'Sin Cliente') AS "Cliente"
            FROM visita v
            LEFT JOIN usuario urepo ON v.id_repo = urepo.id
            LEFT JOIN usuario ucli  ON v.id_cliente = ucli.id
            LEFT JOIN sucursal s    ON v.id_sucursal = s.id
            LEFT JOIN cadena ca     ON s.id_cadena = ca.id
            WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (fecha_desde) { sql += ` AND v.fecha >= $${idx++}`; params.push(fecha_desde); }
        if (fecha_hasta) { sql += ` AND v.fecha <= $${idx++}`; params.push(fecha_hasta); }
        if (id_cadena)   { sql += ` AND s.id_cadena = $${idx++}`; params.push(id_cadena); }
        if (id_sucursal) { sql += ` AND v.id_sucursal = $${idx++}`; params.push(id_sucursal); }
        if (id_cliente)  { sql += ` AND v.id_cliente = $${idx++}`; params.push(id_cliente); }

        sql += ' ORDER BY v.fecha DESC';
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/visitas-pendientes', async (req, res, next) => {
    try {
        const result = await query(`
            SELECT v.id AS "ID_Visita", v.fecha AS "Fecha",
                   urepo.nombre AS "Repositor", ucli.nombre AS "Cliente",
                   s.calle || ' ' || COALESCE(CAST(s.altura AS VARCHAR), 'S/N') AS "Sucursal"
            FROM visita v
            JOIN sucursal s       ON v.id_sucursal = s.id
            JOIN usuario urepo    ON v.id_repo = urepo.id
            JOIN usuario ucli     ON v.id_cliente = ucli.id
            WHERE EXISTS (
                SELECT 1 FROM carga c WHERE c.id_visita = v.id AND c.estado = 'Pendiente'
            )
            ORDER BY v.fecha DESC
        `);
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/visitas-repositor', async (req, res, next) => {
    const { id_repo, fecha_desde, fecha_hasta } = req.query;
    try {
        const result = await query(`
            SELECT v.fecha, ucli.nombre AS cliente,
                   ca.nombre AS cadena,
                   s.calle || ' ' || COALESCE(CAST(s.altura AS VARCHAR), 'S/N') || ', ' || s.localidad AS sucursal,
                   COUNT(c.id) AS productos,
                   CASE WHEN COUNT(c.id) = COUNT(CASE WHEN c.estado = 'Aprobado' THEN 1 END) THEN 'Aprobado'
                        WHEN COUNT(CASE WHEN c.estado = 'Rechazado' THEN 1 END) > 0 THEN 'Rechazado'
                        ELSE 'Pendiente' END AS estado
            FROM visita v
            JOIN usuario ucli ON v.id_cliente = ucli.id
            JOIN sucursal s ON v.id_sucursal = s.id
            JOIN cadena ca ON s.id_cadena = ca.id
            LEFT JOIN carga c ON v.id = c.id_visita
            WHERE v.id_repo = $1
            AND v.fecha >= $2
            AND v.fecha <= $3
            GROUP BY v.id, v.fecha, ucli.nombre, s.calle, s.altura, s.localidad, ca.nombre
            ORDER BY v.fecha DESC
        `, [id_repo, fecha_desde, fecha_hasta]);
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.patch('/api/aprobar-visita/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'ID inválido' });
    try {
        const result = await query(
            `UPDATE carga SET estado = 'Aprobado' WHERE id_visita = $1 AND estado = 'Pendiente'`,
            [id]
        );
        if (result.rowCount === 0)
            return res.status(404).json({ success: false, message: 'No se encontraron cargas pendientes.' });
        res.json({ success: true, message: `Visita #${id} aprobada correctamente.` });
    } catch (e) { next(e); }
});

app.patch('/api/rechazar-visita/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'ID inválido' });
    try {
        const result = await query(
            `UPDATE carga SET estado = 'Rechazado' WHERE id_visita = $1 AND estado = 'Pendiente'`,
            [id]
        );
        if (result.rowCount === 0)
            return res.status(404).json({ success: false, message: 'No se encontraron cargas pendientes.' });
        res.json({ success: true, message: `Visita #${id} rechazada correctamente.` });
    } catch (e) { next(e); }
});

app.post('/api/visitas/estado', async (req, res, next) => {
    try {
        await query('UPDATE carga SET estado = $1 WHERE id = $2', [req.body.estado, req.body.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// FILTROS Y REPORTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/zonas', async (req, res, next) => {
    try {
        const result = await query('SELECT id, nombre FROM zona ORDER BY nombre');
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/sucursales-lista', async (req, res, next) => {
    try {
        const result = await query(
            `SELECT id, calle || COALESCE(' ' || CAST(altura AS VARCHAR), ' S/N') AS "Nombre"
             FROM sucursal ORDER BY calle`
        );
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/filtros-opciones', async (req, res, next) => {
    try {
        const [cadenas, sucursales, canales, regiones, categorias] = await Promise.all([
            query('SELECT id, nombre FROM cadena ORDER BY nombre'),
            query(`SELECT id, calle || COALESCE(' ' || CAST(altura AS VARCHAR), ' S/N') AS nombre FROM sucursal ORDER BY calle`),
            query('SELECT id, tipo AS nombre FROM tipo_cadena ORDER BY tipo'),
            query('SELECT id, nombre FROM zona ORDER BY nombre'),
            query('SELECT id, categoria AS nombre FROM categoria ORDER BY categoria'),
        ]);
        res.json({
            cadenas: cadenas.rows,
            sucursales: sucursales.rows,
            canales: canales.rows,
            regiones: regiones.rows,
            categorias: categorias.rows
        });
    } catch (e) { next(e); }
});

app.get('/api/filtros-opciones-visitas', async (req, res, next) => {
    try {
        const [cadenas, clientes] = await Promise.all([
            query('SELECT id, nombre FROM cadena ORDER BY nombre'),
            query(`SELECT u.id, u.nombre FROM usuario u JOIN tipo_usuario t ON u.id_tipo_usuario = t.id WHERE t.tipo = 'Cliente' ORDER BY u.nombre`)
        ]);
        res.json({ cadenas: cadenas.rows, clientes: clientes.rows });
    } catch (e) { next(e); }
});

const BASE_SELECT_REPORTE = `
    SELECT c.id AS "ID_Carga", v.fecha AS "Fecha",
           ucli.nombre AS "Cliente", ca.nombre AS "Cadena",
           s.calle || COALESCE(' ' || CAST(s.altura AS VARCHAR), ' S/N') AS "Comercio",
           s.localidad AS "Localidad",
           z.nombre AS "Region", sz.nombre AS "Cluster",
           tc.tipo AS "Canal", urepo.nombre AS "Usuario",
           cat.categoria AS "Categoria", p.descripcion AS "Producto",
           p.sku AS "SKU", c.precio AS "Precio",
           CASE WHEN c.oferta THEN 'Sí' ELSE 'No' END AS "Oferta",
           v.id AS "ID_Visita", c.estado AS "Estado"
    FROM visita v
    JOIN sucursal s      ON v.id_sucursal = s.id
    JOIN cadena ca       ON s.id_cadena = ca.id
    JOIN tipo_cadena tc  ON ca.id_tipo = tc.id
    JOIN subzona sz      ON s.id_subzona = sz.id
    JOIN zona z          ON sz.id_zona = z.id
    JOIN usuario urepo   ON v.id_repo = urepo.id
    LEFT JOIN usuario ucli ON v.id_cliente = ucli.id
    JOIN carga c         ON v.id = c.id_visita
    JOIN producto p      ON c.id_producto = p.id
    JOIN categoria cat   ON p.id_categoria = cat.id
`;

function buildFiltrosReporte(reqQuery, params, extraWhere = '') {
    const { fecha_desde, fecha_hasta, id_cadena, id_sucursal, id_canal, id_region, id_categoria, id_cliente } = reqQuery;
    const conds = [];
    if (extraWhere) conds.push(extraWhere);

    if (fecha_desde)  { conds.push(`v.fecha >= $${params.push(fecha_desde)}`); }
    if (fecha_hasta)  { conds.push(`v.fecha <= $${params.push(fecha_hasta)}`); }
    if (id_cadena)    { conds.push(`ca.id = $${params.push(id_cadena)}`); }
    if (id_sucursal)  { conds.push(`s.id = $${params.push(id_sucursal)}`); }
    if (id_canal)     { conds.push(`ca.id_tipo = $${params.push(id_canal)}`); }
    if (id_region)    { conds.push(`z.id = $${params.push(id_region)}`); }
    if (id_categoria) { conds.push(`cat.id = $${params.push(id_categoria)}`); }
    if (id_cliente)   { conds.push(`v.id_cliente = $${params.push(id_cliente)}`); }

    return conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
}

app.get('/api/reporte-visitas', async (req, res, next) => {
    try {
        const params = [];
        const where = buildFiltrosReporte(req.query, params);
        const result = await query(`${BASE_SELECT_REPORTE} ${where} ORDER BY v.fecha DESC`, params);
        res.json(result.rows);
    } catch (e) { next(e); }
});

app.get('/api/reporte-visitas-cliente', async (req, res, next) => {
    const { id_cliente } = req.query;
    if (!id_cliente) return res.status(400).json({ error: 'Falta id_cliente' });
    try {
        const check = await query(
            `SELECT id FROM usuario WHERE id = $1
             AND id_tipo_usuario = (SELECT id FROM tipo_usuario WHERE tipo = 'Cliente')`,
            [id_cliente]
        );
        if (check.rows.length === 0)
            return res.status(403).json({ error: 'Acceso no autorizado' });

        const params = [id_cliente];
        const where = buildFiltrosReporte(req.query, params, `v.id_cliente = $1`);
        const result = await query(`${BASE_SELECT_REPORTE} ${where} ORDER BY v.fecha DESC`, params);
        res.json(result.rows);
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// CARGA IMÁGENES POR CLIENTE
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/carga-imagenes-por-cliente', async (req, res, next) => {
    const { id_cliente } = req.query;
    if (!id_cliente) return res.status(400).json({ error: 'Falta id_cliente' });
    try {
        const check = await query('SELECT id FROM usuario WHERE id = $1', [id_cliente]);
        if (check.rows.length === 0)
            return res.status(404).json({ error: 'Cliente no encontrado' });

        const result = await query(`
            SELECT DISTINCT s.id AS "idSucursal",
                   c.nombre || ' - ' || s.calle || ' ' || COALESCE(CAST(s.altura AS VARCHAR),'') ||
                       ', ' || s.localidad AS "NombreSucursal",
                   CASE WHEN EXISTS (
                        SELECT 1 FROM visita v2
                        JOIN imagen im ON im.id_visita = v2.id
                        WHERE v2.id_sucursal = s.id
                          AND v2.id_cliente = $1
                          AND DATE_TRUNC('month', v2.fecha) = DATE_TRUNC('month', CURRENT_DATE)
                   ) THEN 1 ELSE 0 END AS "TieneImagenes"
            FROM abastece a
            JOIN sucursal s ON a.id_sucursal = s.id
            LEFT JOIN cadena c ON s.id_cadena = c.id
            WHERE a.id_cliente = $1
            ORDER BY "NombreSucursal"
        `, [id_cliente]);

        res.json(result.rows);
    } catch (e) { next(e); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// PROXY DE IMÁGENES R2 (evita CORS en el frontend al generar PPTX)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/proxy-imagen', (req, res, next) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Falta url');

    if (!url.startsWith(process.env.R2_PUBLIC_URL)) {
        return res.status(403).send('URL no permitida');
    }

    const client = url.startsWith('https') ? https : http;
    client.get(url, (imgRes) => {
        res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        imgRes.pipe(res);
    }).on('error', next);
});


// ═══════════════════════════════════════════════════════════════════════════════
// MANEJO DE ERRORES
// ═══════════════════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor listo en http://localhost:${PORT}`));
