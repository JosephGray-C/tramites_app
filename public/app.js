// Helper to get auth token
function getToken() {
    return localStorage.getItem('token');
}

// Helper to set auth token
function setToken(token) {
    if (token) {
        localStorage.setItem('token', token);
    } else {
        localStorage.removeItem('token');
    }
}

// API call with JWT token
const api = (path, opts = {}) => {
    const token = getToken();
    const headers = opts.headers || {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch('/api' + path, { ...opts, headers }).then(r => r.json());
};

// Check session on page load - but DON'T redirect from login/register pages
window.addEventListener('load', async () => {
    const session = await api('/session');
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    // Only redirect if accessing protected pages without auth
    const protectedPages = ['my_tramites.html', 'admin.html', 'register.html'];

    if (!session.authenticated && protectedPages.includes(currentPage)) {
        window.location.href = '/login.html';
    }
});

// Beautiful MFA modal popup
function showMFAModal(code) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '9999';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-header">
            <div class="modal-icon success">📧</div>
            <div class="modal-title">Código MFA</div>
        </div>
        <div class="modal-body">
            <p style="font-size: 14px; color: #64748b; margin-bottom: 16px;">
                Un código MFA ha sido generado. Ingrese este código para continuar:
            </p>
            <div style="
                background: linear-gradient(135deg, #0b5cff, #2563eb);
                color: white;
                padding: 20px;
                border-radius: 8px;
                text-align: center;
                font-size: 28px;
                font-weight: 700;
                letter-spacing: 4px;
                font-family: 'Courier New', monospace;
                margin: 20px 0;
            ">${code}</div>
            <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                (En un sistema real, esto llegaría por correo)
            </p>
        </div>
        <div class="modal-footer">
            <button class="btn primary" id="closeMFABtn">Entendido</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.getElementById('closeMFABtn').onclick = () => overlay.remove();
}

// UI helpers: toast and modal
function showToast(message, type = 'info', timeout = 3500) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div'); t.className = `toast ${type}`; t.innerText = message; wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, timeout);
}

// Download document using fetch with Authorization header
async function downloadDocument(tramiteId, fileName) {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
        const res = await fetch(`/api/tramites/${tramiteId}/document/${fileName}`, { headers });
        if (!res.ok) throw new Error('No se pudo descargar el documento');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
        showModal('Error', err.message || 'Error al descargar documento', 'error');
    }
}

function showModal(title, message, type = 'info', okLabel = 'Aceptar') {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const modal = document.createElement('div'); modal.className = 'modal';
    const icon = document.createElement('div'); icon.className = `modal-icon ${type === 'error' ? 'error' : 'success'}`; icon.innerText = type === 'error' ? '!' : '✓';
    const hdr = document.createElement('div'); hdr.className = 'modal-header';
    const titleEl = document.createElement('div'); titleEl.className = 'modal-title'; titleEl.innerText = title;
    hdr.appendChild(icon); hdr.appendChild(titleEl);
    const body = document.createElement('div'); body.className = 'modal-body'; body.innerText = message;
    const footer = document.createElement('div'); footer.className = 'modal-footer';
    const btn = document.createElement('button'); btn.className = 'btn primary'; btn.innerText = okLabel; btn.onclick = () => { overlay.remove(); };
    footer.appendChild(btn);
    modal.appendChild(hdr); modal.appendChild(body); modal.appendChild(footer);
    overlay.appendChild(modal); document.body.appendChild(overlay);
    overlay.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
    // ===== REGISTER FORM =====
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(registerForm);
            const body = {
                nombre: fd.get('nombre'),
                email: fd.get('email'),
                cedula: fd.get('cedula'),
                rol: fd.get('rol')
            };
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const j = await res.json();
            if (j.error) {
                showModal('Error en registro', j.error, 'error');
            } else {
                // Save token for future requests
                setToken(j.token);
                showModal('¡Bienvenido!', `Sesión iniciada como ${j.user.nombre}`, 'success');
                const destino = j.user.rol === 'Funcionario' ? '/admin.html' : '/register.html';
                setTimeout(() => location.href = destino, 1500);
            }
        });
    }

    // ===== LOGIN FORM =====
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(loginForm);
            const body = {
                email: fd.get('email'),
                cedula: fd.get('cedula')
            };
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const j = await res.json();
            if (j.error) {
                showModal('Error', j.error, 'error');
            } else {
                showMFAModal(j.code);
                const mfaForm = document.getElementById('mfaForm');
                if (mfaForm) mfaForm.style.display = 'block';
                loginForm.style.display = 'none';
                showToast('Código MFA generado', 'info');
            }
        });
    }

    // ===== MFA FORM =====
    const mfaForm = document.getElementById('mfaForm');
    if (mfaForm) {
        mfaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = new FormData(mfaForm).get('code');
            const res = await fetch('/api/verify-mfa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const j = await res.json();
            if (j.error) {
                showModal('Código inválido', j.error, 'error');
            } else {
                // Save token for future requests
                setToken(j.token);
                showModal('¡Autenticado!', `Bienvenido ${j.user.nombre}`, 'success');
                const destino = j.user.rol === 'Funcionario' ? '/admin.html' : '/register.html';
                setTimeout(() => location.href = destino, 1500);
            }
        });
    }

    // ===== TRAMITE FORM (Register Trámite) =====
    const tramiteForm = document.getElementById('tramiteForm');
    if (tramiteForm) {
        tramiteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const fd = new FormData(form);
            const token = getToken();
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const res = await fetch('/api/tramites', {
                method: 'POST',
                headers: headers,
                body: fd
            });
            const j = await res.json();
            if (j.error) {
                showModal('Error', j.error, 'error');
            } else {
                showModal('Trámite registrado', j.message || 'Trámite registrado con éxito', 'success');
                form.reset();
                if (document.getElementById('tramiteResult')) {
                    document.getElementById('tramiteResult').innerText = '';
                }
            }
        });
    }

    // ===== MY TRAMITES - REFRESH LIST =====
    const refresh = document.getElementById('refresh');
    if (refresh) {
        refresh.addEventListener('click', async () => {
            const div = document.getElementById('list');
            div.innerHTML = '<div class="muted-small">Cargando...</div>';
            const j = await api('/tramites');
            if (j.error) { div.innerText = j.error; return; }
            if (j.length === 0) { div.innerHTML = '<div class="muted-small">No hay trámites.</div>'; return; }
            const table = document.createElement('table');
            table.className = 'table-list';
            table.innerHTML = '<thead><tr><th>ID</th><th>Versión</th><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead><tbody></tbody>';
            const tbody = table.querySelector('tbody');
            j.forEach(t => {
                const tr = document.createElement('tr');
                const badgeClass = (s) => s === 'Pendiente' ? 'status-pendiente' : s === 'EnRevisión' ? 'status-enrevision' : s === 'Aprobado' ? 'status-aprobado' : s === 'Rechazado' ? 'status-rechazado' : 'status-archivado';
                tr.innerHTML = `<td>${t.id.substring(0, 8)}...</td><td>${t.version}</td><td>${t.datos.nombre}</td><td><span class="status-badge ${badgeClass(t.estado)}">${t.estado}</span></td><td></td>`;
                const actions = tr.querySelector('td:last-child');
                if (t.estado === 'Rechazado') {
                    const btn = document.createElement('button');
                    btn.className = 'action-btn primary';
                    btn.innerText = 'Reenviar';
                    btn.onclick = () => { openResendForm(t); };
                    actions.appendChild(btn);
                }
                if (t.documentos && t.documentos.length) {
                    t.documentos.forEach(d => {
                        const link = document.createElement('button');
                        link.className = 'doc-link';
                        link.type = 'button';
                        link.innerText = d.name;
                        link.style.display = 'block';
                        link.style.fontSize = '12px';
                        link.style.marginTop = '6px';
                        link.onclick = () => downloadDocument(t.id, d.file);
                        actions.appendChild(link);
                    });
                }
                tbody.appendChild(tr);
            });
            div.innerHTML = '';
            div.appendChild(table);
        });
    }

    // ===== ADMIN BANDEJA - LOAD ALL =====
    const loadAll = document.getElementById('loadAll');
    if (loadAll) {
        loadAll.addEventListener('click', async () => {
            const div = document.getElementById('table');
            div.innerHTML = '<div class="muted-small">Cargando...</div>';
            const j = await api('/tramites');
            if (j.error) { div.innerText = j.error; return; }
            if (j.length === 0) { div.innerHTML = '<div class="muted-small">No hay trámites.</div>'; return; }
            const table = document.createElement('table');
            table.className = 'table-list';
            table.innerHTML = '<thead><tr><th>ID</th><th>Versión</th><th>Nombre</th><th>Estado</th><th>Acción</th></tr></thead><tbody></tbody>';
            const tbody = table.querySelector('tbody');
            j.forEach(t => {
                const tr = document.createElement('tr');
                const badgeClass = (s) => s === 'Pendiente' ? 'status-pendiente' : s === 'EnRevisión' ? 'status-enrevision' : s === 'Aprobado' ? 'status-aprobado' : s === 'Rechazado' ? 'status-rechazado' : 'status-archivado';
                tr.innerHTML = `<td>${t.id.substring(0, 8)}...</td><td>${t.version}</td><td>${t.datos.nombre}</td><td><span class="status-badge ${badgeClass(t.estado)}">${t.estado}</span></td><td></td>`;
                const actions = tr.querySelector('td:last-child');
                const sel = document.createElement('select');
                sel.innerHTML = '<option value="">Seleccionar estado...</option><option>Pendiente</option><option>EnRevisión</option><option>Aprobado</option><option>Rechazado</option><option>Archivado</option>';
                const btn = document.createElement('button');
                btn.className = 'action-btn primary';
                btn.innerText = 'Actualizar';
                btn.onclick = async () => {
                    const estado = sel.value;
                    if (!estado) return showToast('Seleccione un estado', 'warning');
                    const token = getToken();
                    const headers = { 'Content-Type': 'application/json' };
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    const res = await fetch(`/api/tramites/${t.id}/state`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ estado })
                    });
                    const rj = await res.json();
                    if (rj.error) showModal('Error', rj.error, 'error');
                    else { showModal('Éxito', rj.message, 'success'); }
                };
                actions.appendChild(sel);
                actions.appendChild(btn);
                if (t.documentos && t.documentos.length) {
                    t.documentos.forEach(d => {
                        const link = document.createElement('button');
                        link.className = 'doc-link';
                        link.type = 'button';
                        link.innerText = d.name;
                        link.style.display = 'block';
                        link.style.fontSize = '12px';
                        link.style.marginTop = '6px';
                        link.onclick = () => downloadDocument(t.id, d.file);
                        actions.appendChild(link);
                    });
                }
                tbody.appendChild(tr);
            });
            div.innerHTML = '';
            div.appendChild(table);
        });
    }

    // ===== RESEND FORM MODAL =====
    function openResendForm(t) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-header">
                <div class="modal-icon success">⟳</div>
                <div class="modal-title">Reenviar trámite ${t.id.substring(0, 8)}... (v${t.version})</div>
            </div>
            <div class="modal-body">
                <form id="resendForm">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Nombre</label>
                            <input name="nombre" value="${t.datos.nombre}" required>
                        </div>
                        <div class="form-group">
                            <label>Cédula</label>
                            <input name="cedula" value="${t.datos.cedula}" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label>Email</label>
                            <input type="email" name="email" value="${t.datos.email}" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label>Archivos (opcional)</label>
                            <input type="file" name="docs" multiple>
                        </div>
                    </div>
                    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
                        <button type="button" id="cancelBtn" class="btn ghost">Cancelar</button>
                        <button type="submit" class="btn primary">Reenviar</button>
                    </div>
                </form>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('cancelBtn').onclick = () => overlay.remove();

        document.getElementById('resendForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const token = getToken();
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(`/api/tramites/${t.id}/resend`, {
                method: 'POST',
                headers,
                body: fd
            });
            const j = await res.json();
            overlay.remove();
            if (j.error) {
                showModal('Error', j.error, 'error');
            } else {
                showModal('Éxito', j.message, 'success');
                if (refresh) refresh.click();
            }
        });
    }
});
