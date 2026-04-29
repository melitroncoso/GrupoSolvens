// ── Referencias ──
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const btnCerrarSidebar = document.getElementById('btnCerrarSidebar');
const sidebarFiltros   = document.getElementById('sidebarFiltros');

// Abre el sidebar
btnToggleSidebar.addEventListener('click', () => {
    sidebarFiltros.classList.add('activo');
});

// Cierra el sidebar con la X
btnCerrarSidebar.addEventListener('click', () => {
    sidebarFiltros.classList.remove('activo');
});

// Cierra el sidebar al hacer clic fuera (sobre el overlay oscuro de fondo)
document.addEventListener('click', (e) => {
    if (
        sidebarFiltros.classList.contains('activo') &&
        !sidebarFiltros.contains(e.target) &&
        e.target !== btnToggleSidebar &&
        !btnToggleSidebar.contains(e.target)
    ) {
        sidebarFiltros.classList.remove('activo');
    }
});

// Cierra con tecla Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        sidebarFiltros.classList.remove('activo');
        document.getElementById('sfDropdown').style.display = 'none';
        document.getElementById('sfOverlay').classList.remove('activo');
    }
});