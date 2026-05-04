const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const btnCerrarSidebar = document.getElementById('btnCerrarSidebar');
const sidebarFiltros   = document.getElementById('sidebarFiltros');

// ── Crear wrapper scrolleable y marcar el grupo periodo ───────────────────
(function wrapGrupos() {
    const grupos = Array.from(sidebarFiltros.querySelectorAll('.grupo-filtro'));
    if (!grupos.length) return;

    // Insertar el wrapper justo antes de .botones-filtro (o al final del aside)
    const botones = sidebarFiltros.querySelector('.botones-filtro');
    const wrapper = document.createElement('div');
    wrapper.className = 'sidebar-grupos';

    if (botones) {
        sidebarFiltros.insertBefore(wrapper, botones);
    } else {
        sidebarFiltros.appendChild(wrapper);
    }

    // Mover TODOS los grupos al wrapper, sin importar en qué nivel estaban
    grupos.forEach(g => wrapper.appendChild(g));

    // El primer grupo (Periodo / fechas) ocupa las 2 columnas
    grupos[0].classList.add('filtro-periodo');

    // Mostrar contenido de todos (sin acordeón)
    grupos.forEach(g => {
        const contenido = g.querySelector('.filtro-contenido');
        if (contenido) contenido.style.maxHeight = 'none';
    });

    // Limpiar contenedores vacíos que hayan quedado (ej: .sidebar-cuerpo sin hijos)
    sidebarFiltros.querySelectorAll('.sidebar-cuerpo').forEach(el => {
        if (!el.children.length) el.remove();
    });
})();

// ── Abrir / cerrar sidebar ────────────────────────────────────────────────
function abrirSidebar() {
    sidebarFiltros.classList.add('activo');
    btnToggleSidebar.classList.add('oculto');
    document.body.classList.add('sidebar-abierto');
}

function cerrarSidebar() {
    sidebarFiltros.classList.remove('activo');
    btnToggleSidebar.classList.remove('oculto');
    document.body.classList.remove('sidebar-abierto');
}

btnToggleSidebar.addEventListener('click', abrirSidebar);
btnCerrarSidebar.addEventListener('click', cerrarSidebar);

const sidebarOverlay = document.getElementById('sidebarOverlay');
if (sidebarOverlay) sidebarOverlay.addEventListener('click', cerrarSidebar);