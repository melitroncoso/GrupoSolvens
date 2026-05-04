const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const btnCerrarSidebar = document.getElementById('btnCerrarSidebar');
const sidebarFiltros   = document.getElementById('sidebarFiltros');

// ── Crear wrapper scrolleable para los grupos de filtros ──────────────────
(function wrapGrupos() {
    const grupos  = sidebarFiltros.querySelectorAll('.grupo-filtro');
    if (!grupos.length) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'sidebar-grupos';

    sidebarFiltros.insertBefore(wrapper, grupos[0]);
    grupos.forEach(g => wrapper.appendChild(g));
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

// Cerrar al hacer clic en el overlay si existe
const sidebarOverlay = document.getElementById('sidebarOverlay');
if (sidebarOverlay) sidebarOverlay.addEventListener('click', cerrarSidebar);

// ── Acordeón de filtros ───────────────────────────────────────────────────
document.querySelectorAll('.filtro-header').forEach(header => {
    header.addEventListener('click', () => {
        const contenido   = header.nextElementSibling;
        const icono       = header.querySelector('.icono-toggle');
        const grupoFiltro = header.parentElement;

        grupoFiltro.classList.toggle('colapsado');

        if (grupoFiltro.classList.contains('colapsado')) {
            contenido.style.maxHeight = '0';
            icono.style.transform     = 'rotate(-90deg)';
        } else {
            contenido.style.maxHeight = contenido.scrollHeight + 'px';
            icono.style.transform     = 'rotate(0deg)';
        }
    });
});

// ── Colapsar todos al cargar ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.grupo-filtro').forEach(grupo => {
        grupo.classList.add('colapsado');
        const contenido = grupo.querySelector('.filtro-contenido');
        const icono     = grupo.querySelector('.icono-toggle');
        if (contenido) contenido.style.maxHeight = '0';
        if (icono)     icono.style.transform     = 'rotate(-90deg)';
    });
});