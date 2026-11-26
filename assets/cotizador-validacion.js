// assets/cotizador-validacion.js
(() => {
  "use strict";

  const LS_REGISTROS = "alfa:registros_enviados:v1";
  const LS_CART = "alfa:cotizacion:v2";

  const CAMPOS_LIMPIOS = {
    empresa: "",
    contacto: "",
    telefono: "",
    correo: "",
    cp: "",
    fecha: "",
    notas: "",
  };

  const normalizarEmpresa = (v = "") =>
    String(v)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normalizarTelefono = (v = "") => String(v).replace(/\D/g, "");

  const normalizarCorreo = (v = "") => String(v).trim().toLowerCase();

  function leerRegistrosLocales() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_REGISTROS) || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function guardarRegistroLocal({ empresa, telefono, correo }) {
    const actuales = leerRegistrosLocales();
    actuales.push({
      empresaNorm: normalizarEmpresa(empresa),
      telefonoNorm: normalizarTelefono(telefono),
      correoNorm: normalizarCorreo(correo),
      fecha: new Date().toISOString(),
    });
    try {
      localStorage.setItem(LS_REGISTROS, JSON.stringify(actuales));
    } catch {}
  }

  function buscarDuplicadosLocales({ empresa, telefono, correo }) {
    const empNorm = normalizarEmpresa(empresa);
    const telNorm = normalizarTelefono(telefono);
    const corNorm = normalizarCorreo(correo);
    const registros = leerRegistrosLocales();

    const fields = [];
    if (empNorm && registros.some((r) => r.empresaNorm === empNorm)) fields.push("empresa");
    if (telNorm && registros.some((r) => r.telefonoNorm === telNorm)) fields.push("telefono");
    if (corNorm && registros.some((r) => r.correoNorm === corNorm)) fields.push("correo");

    const nombres = {
      empresa: "La empresa",
      telefono: "El teléfono",
      correo: "El correo",
    };

    const message =
      fields.length > 0
        ? `${fields.map((f) => nombres[f]).join(", ")} ya ${fields.length > 1 ? "existen y están registrados" : "existe y está registrado"}. Deben ser distintos.`
        : "";

    return { hasDuplicate: fields.length > 0, fields, message };
  }

  function obtenerCampo(root, nombre) {
    return (
      root.querySelector(`[name="${nombre}"]`) ||
      root.querySelector(`#f_${nombre}, #${nombre}`)
    );
  }

  function mostrarErrorCampo(root, nombre, mensaje) {
    const input = obtenerCampo(root, nombre);
    if (!input) return;
    input.setAttribute("aria-invalid", "true");
    input.classList.add("is-invalid");

    let errEl =
      root.querySelector(`[data-err-for="${nombre}"]`) ||
      input.parentElement?.querySelector(".err");

    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "err";
      errEl.dataset.errFor = nombre;
      input.insertAdjacentElement("afterend", errEl);
    }
    errEl.textContent = mensaje;
    errEl.hidden = false;
  }

  function limpiarErroresFormulario(root = document) {
    root.querySelectorAll('[aria-invalid="true"], .is-invalid').forEach((el) => {
      el.removeAttribute("aria-invalid");
      el.classList.remove("is-invalid");
    });
    root.querySelectorAll(".err[data-err-for]").forEach((el) => {
      el.textContent = "";
      el.hidden = true;
    });
  }

  /**
   * Limpia por completo formulario, datos anteriores en estado/storage y errores.
   * @param {object} opts - { state, makeFolio, onAfterReset }
   */
  function limpiarFormularioYDatosAnteriores(opts = {}) {
    const root = document.querySelector("#sheet") || document;
    const form = root.querySelector("form");

    if (form && typeof form.reset === "function") {
      form.reset();
    }

    Object.entries(CAMPOS_LIMPIOS).forEach(([campo, valor]) => {
      const el = obtenerCampo(root, campo);
      if (el && "value" in el) {
        el.value = valor;
      }
    });

    limpiarErroresFormulario(root);

    if (opts.state) {
      opts.state.cliente = {
        empresa: "",
        contacto: "",
        telefono: "",
        correo: "",
        cp: "",
        asap: true,
        fecha: "",
        notas: "",
        docFicha: true,
        docSds: true,
      };
      opts.state.items = [];
      opts.state.enviado = null;
      if (typeof opts.makeFolio === "function") {
        opts.state.folio = opts.makeFolio();
      }
    }

    try {
      localStorage.removeItem(LS_CART);
    } catch {}

    if (typeof opts.onAfterReset === "function") {
      opts.onAfterReset();
    }
  }

  /**
   * Valida duplicados (local + /api/leads) antes de confirmar envío.
   * Retorna { ok: true } si se puede enviar, o { ok: false, error } si ya existe.
   */
  async function validarYRegistrarSinDuplicados({ cliente, items = [], folio = "" }) {
    const root = document.querySelector("#sheet") || document;
    limpiarErroresFormulario(root);

    const localCheck = buscarDuplicadosLocales(cliente);
    if (localCheck.hasDuplicate) {
      localCheck.fields.forEach((campo) => {
        mostrarErrorCampo(root, campo, `Este dato (${campo}) ya está registrado.`);
      });
      return { ok: false, error: localCheck.message, fields: localCheck.fields };
    }

    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folio, cliente, items }),
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.status === 409 || data.duplicate) {
        const fields = Array.isArray(data.fields) && data.fields.length
          ? data.fields
          : ["empresa", "telefono", "correo"];
        fields.forEach((campo) => {
          mostrarErrorCampo(root, campo, `Ya existe en el sistema.`);
        });
        return {
          ok: false,
          error: data.error || "La empresa, teléfono o correo ya están registrados.",
          fields,
        };
      }

      if (!resp.ok) {
        return {
          ok: false,
          error: data.error || "No se pudo validar el registro en el servidor.",
        };
      }
    } catch {
      // Si se abre en entorno estático sin función serverless /api/leads, se apoya en el registro local
    }

    guardarRegistroLocal(cliente);
    return { ok: true };
  }

  // Exponer en window por si el <script> principal de index.html no usa type="module"
  window.AlfaCotizadorGuard = {
    normalizarEmpresa,
    normalizarTelefono,
    normalizarCorreo,
    buscarDuplicadosLocales,
    limpiarErroresFormulario,
    limpiarFormularioYDatosAnteriores,
    validarYRegistrarSinDuplicados,
  };
})();