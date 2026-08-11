<div align="center">

<img src="icons/icon.svg" width="96" alt="MAI-Background" />

# MAI-Background

**Elimina el fondo de tus videos con precisión — directo en el navegador.**

Sube un video de una persona, quita o reemplaza el fondo en tiempo real y crea
montajes graciosos y originales. Sin subir nada a un servidor.

[· Demo en vivo ·](https://mai-software.github.io/MAI-Background/) · PWA instalable · 100% local

</div>

---

## ✨ Qué hace

- **Recorte de personas con matting real** (canal alfa continuo, no máscara binaria), cuadro a cuadro, con [Robust Video Matting (RVM)](https://github.com/PeterL1n/RobustVideoMatting) — bordes, pelo y semitransparencias con precisión, y estabilidad temporal (sin parpadeo) gracias a su memoria recurrente.
- **Fondos a elegir:**
  - 🫥 **Transparente** (canal alfa)
  - 🎨 **Color** sólido (con presets, incluido verde croma)
  - 🌫️ **Desenfoque** del fondo original
  - 🖼️ **Imagen** propia
  - 🎬 **Otro video** de fondo
- **Suavizado de bordes** ajustable.
- **Exporta a WebM** conservando el audio original (`MediaRecorder`).
- **PWA**: instalable como app de escritorio o móvil, funciona offline.
- **Privacidad total**: el video nunca sale de tu dispositivo.

## 🚀 Uso

1. Abre la [demo](https://mai-software.github.io/MAI-Background/) (o sirve la carpeta localmente).
2. Arrastra un video donde aparezca una persona.
3. Elige el tipo de fondo en el panel derecho.
4. Pulsa **Grabar y exportar** y deja que se reproduzca de inicio a fin.
5. Descarga tu `.webm`.

> Optimizado para clips con **una persona** (selfie, baile, presentación). El modelo separa a la persona del fondo.

## 🛠️ Tecnología

| Capa | Detalle |
|------|---------|
| UI | HTML + CSS (sin framework), tema Dark OLED, tipografía Inter |
| IA | Robust Video Matting (`rvm_mobilenetv3_fp32.onnx`) vía [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/) — **WebGPU** con fallback a **WASM** |
| Render | `<canvas>` 2D con compositing (`destination-over`) |
| Export | `canvas.captureStream()` + `MediaRecorder` (VP9/VP8 + audio) |
| App | PWA (manifest + service worker, offline-first) |

No requiere build. Es HTML/CSS/JS estático. El modelo (~14 MB) se sirve
desde `models/` y se cachea en el dispositivo tras la primera carga.

## 💻 Desarrollo local

Necesita servirse por HTTP (el service worker y los módulos no funcionan con `file://`):

```bash
# Python
python -m http.server 8080
# o Node
npx serve .
```

Luego abre `http://localhost:8080`.

## 🌐 Despliegue (GitHub Pages)

El repo se publica desde la rama `main` (raíz). Una vez activado Pages:

```
https://mai-software.github.io/MAI-Background/
```

## ⚠️ Compatibilidad

- Chrome / Edge / Chromium con **WebGPU**: rendimiento óptimo (recomendado).
- Sin WebGPU: cae a WASM (single-thread) — funciona, pero más lento.
- Safari: matting funciona; el formato de exportación WebM puede variar.

## 📄 Licencia

Código de la app: [MIT](LICENSE) © MAI Software.

**Modelo RVM:** el archivo `models/rvm_mobilenetv3_fp32.onnx` proviene de
[PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting),
bajo **GPL-3.0**. Redistribuirlo implica que esa distribución queda sujeta a
GPL-3.0. Revisa esta condición antes de cualquier uso comercial o distribución
pública del producto.
