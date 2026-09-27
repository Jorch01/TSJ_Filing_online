#!/usr/bin/env node
// Genera /og-image.png (1200×630), la imagen que muestran WhatsApp, Facebook,
// LinkedIn y X al compartir el enlace. Esas redes no leen SVG.
// Uso: node herramientas/generar-og.js   (requiere Playwright)
const path = require('path');
const { chromium } = require('playwright');
(async () => {
    const opciones = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
    const navegador = await chromium.launch(opciones);
    const page = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
    await page.goto('file://' + path.join(__dirname, 'og-image.html'));
    await page.screenshot({ path: path.join(__dirname, '..', 'og-image.png') });
    await navegador.close();
    console.log('✓ og-image.png');
})();
