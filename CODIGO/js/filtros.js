const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const btnCerrarSidebar = document.getElementById('btnCerrarSidebar');
const sidebarFiltros   = document.getElementById('sidebarFiltros');

// ── Crear wrapper scrolleable y marcar el grupo periodo ───────────────────
(function wrapGrupos() {
    const grupos  = sidebarFiltros.querySelectorAll('.grupo-filtro');
    if (!grupos.length) return;

    // Usar el contenedor real de los grupos (puede ser .sidebar-cuerpo o el aside mismo)
    const parent = grupos[0].parentElement;

    const wrapper = document.createElement('div');
    wrapper.className = 'sidebar-grupos';
    parent.insertBefore(wrapper, grupos[0]);
    grupos.forEach(g => wrapper.appendChild(g));

    // El primer grupo (Periodo / fechas) ocupa las 2 columnas
    if (grupos[0]) grupos[0].classList.add('filtro-periodo');

    // Mostrar contenido de todos (sin acordeón)
    grupos.forEach(g => {
        const contenido = g.querySelector('.filtro-contenido');
        if (contenido) contenido.style.maxHeight = 'none';
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