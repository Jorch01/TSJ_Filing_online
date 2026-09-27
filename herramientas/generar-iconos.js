#!/usr/bin/env node
// Genera los íconos de la app a partir de docs/icons/icono.svg: los que pide
// Android/Chrome para instalarla (192 y 512, y la versión "maskable" con
// margen para el recorte redondo) y el de iPhone para la pantalla de inicio.
// Uso: node herramientas/generar-iconos.js   (requiere Playwright)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const DIR = path.join(__dirname, '..', 'docs', 'icons');
const svg = fs.readFileSync(path.join(DIR, 'icono.svg'), 'utf8');

// maskable: el sistema recorta en círculo o gota, así que el dibujo va al 80%
// sobre fondo lleno. apple: iOS redondea las esquinas por su cuenta.
const salidas = [
    { archivo: 'icono-192.png', lado: 192 },
    { archivo: 'icono-512.png', lado: 512 },
    { archivo: 'icono-maskable-512.png', lado: 512, margen: 0.1, fondoLleno: true },
    { archivo: 'apple-touch-icon.png', lado: 180, fondoLleno: true },
    { archivo: 'favicon-32.png', lado: 32 }
];

(async () => {
    const opciones = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
    const navegador = await chromium.launch(opciones);
    for (const s of salidas) {
        const page = await navegador.newPage({ viewport: { width: s.lado, height: s.lado } });
        // Con fondo lleno, el degradado lo pone el contenedor: el del SVG se quita
        // para que no se note un cuadro dentro de otro.
        const dibujo = s.fondoLleno ? svg.replace(/<rect[^>]*\/>/, '') : svg;
        const margen = (s.margen || 0) * s.lado;
        await page.setContent(`<html><body style="margin:0;background:${s.fondoLleno ? '#1c4b80' : 'transparent'}">
            <div style="width:${s.lado}px;height:${s.lado}px;display:flex;align-items:center;justify-content:center;
                background:${s.fondoLleno ? 'linear-gradient(135deg,#2f74c0,#1c4b80)' : 'transparent'}">
              <div style="width:${s.lado - 2 * margen}px;height:${s.lado - 2 * margen}px">${dibujo.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
            </div></body></html>`);
        await page.screenshot({ path: path.join(DIR, s.archivo), omitBackground: !s.fondoLleno });
        await page.close();
        console.log('✓', s.archivo);
    }
    await navegador.close();
})();
