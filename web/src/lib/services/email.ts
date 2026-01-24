/**
 * Servicio de Email usando EmailJS (gratuito)
 *
 * Para configurar EmailJS:
 * 1. Crear cuenta en https://www.emailjs.com/ (gratuita, 200 emails/mes)
 * 2. Crear un servicio de email (Gmail, Outlook, etc.)
 * 3. Crear una plantilla de email
 * 4. Copiar el Service ID, Template ID y Public Key
 * 5. Configurar en la aplicación
 */

import emailjs from '@emailjs/browser';
import { obtenerConfiguracion, guardarConfiguracion } from './database';

// ============== TIPOS ==============

export interface ConfiguracionEmail {
  serviceId: string;
  templateIdRecordatorio: string;
  templateIdAlerta: string;
  publicKey: string;
  emailDestino: string;
  nombreUsuario: string;
  configurado: boolean;
}

export interface DatosRecordatorio {
  expediente: string;
  juzgado: string;
  titulo: string;
  descripcion: string;
  fecha: string;
  hora: string;
}

export interface DatosAlerta {
  expediente: string;
  juzgado: string;
  tipoEvento: string;
  titulo: string;
  descripcion: string;
  fechaEvento: string;
  minutosRestantes: number;
}

// ============== ESTADO ==============

let inicializado = false;

// ============== FUNCIONES PRINCIPALES ==============

/**
 * Inicializa EmailJS con la clave pública
 */
export async function inicializarEmail(): Promise<boolean> {
  try {
    const config = await obtenerConfiguracionEmail();
    if (!config.configurado || !config.publicKey) {
      console.warn('EmailJS no está configurado');
      return false;
    }

    emailjs.init(config.publicKey);
    inicializado = true;
    return true;
  } catch (error) {
    console.error('Error al inicializar EmailJS:', error);
    return false;
  }
}

/**
 * Verifica si el servicio de email está configurado
 */
export async function emailConfigurado(): Promise<boolean> {
  const config = await obtenerConfiguracionEmail();
  return config.configurado;
}

/**
 * Obtiene la configuración de email guardada
 */
export async function obtenerConfiguracionEmail(): Promise<ConfiguracionEmail> {
  const serviceId = await obtenerConfiguracion('email_service_id') || '';
  const templateIdRecordatorio = await obtenerConfiguracion('email_template_recordatorio') || '';
  const templateIdAlerta = await obtenerConfiguracion('email_template_alerta') || '';
  const publicKey = await obtenerConfiguracion('email_public_key') || '';
  const emailDestino = await obtenerConfiguracion('email_destino') || '';
  const nombreUsuario = await obtenerConfiguracion('email_nombre_usuario') || '';

  return {
    serviceId,
    templateIdRecordatorio,
    templateIdAlerta,
    publicKey,
    emailDestino,
    nombreUsuario,
    configurado: !!(serviceId && publicKey && emailDestino)
  };
}

/**
 * Guarda la configuración de email
 */
export async function guardarConfiguracionEmail(config: Partial<ConfiguracionEmail>): Promise<void> {
  if (config.serviceId !== undefined) {
    await guardarConfiguracion('email_service_id', config.serviceId);
  }
  if (config.templateIdRecordatorio !== undefined) {
    await guardarConfiguracion('email_template_recordatorio', config.templateIdRecordatorio);
  }
  if (config.templateIdAlerta !== undefined) {
    await guardarConfiguracion('email_template_alerta', config.templateIdAlerta);
  }
  if (config.publicKey !== undefined) {
    await guardarConfiguracion('email_public_key', config.publicKey);
  }
  if (config.emailDestino !== undefined) {
    await guardarConfiguracion('email_destino', config.emailDestino);
  }
  if (config.nombreUsuario !== undefined) {
    await guardarConfiguracion('email_nombre_usuario', config.nombreUsuario);
  }

  // Reinicializar si hay nueva clave pública
  if (config.publicKey) {
    inicializado = false;
    await inicializarEmail();
  }
}

/**
 * Envía un email de recordatorio
 */
export async function enviarRecordatorio(datos: DatosRecordatorio): Promise<{ exito: boolean; mensaje: string }> {
  if (!inicializado) {
    const init = await inicializarEmail();
    if (!init) {
      return { exito: false, mensaje: 'El servicio de email no está configurado' };
    }
  }

  try {
    const config = await obtenerConfiguracionEmail();

    if (!config.templateIdRecordatorio) {
      return { exito: false, mensaje: 'No hay plantilla de recordatorio configurada' };
    }

    const templateParams = {
      to_email: config.emailDestino,
      to_name: config.nombreUsuario || 'Usuario',
      expediente: datos.expediente,
      juzgado: datos.juzgado,
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      fecha: datos.fecha,
      hora: datos.hora,
      app_name: 'TSJ Filing Online'
    };

    const response = await emailjs.send(
      config.serviceId,
      config.templateIdRecordatorio,
      templateParams
    );

    if (response.status === 200) {
      return { exito: true, mensaje: 'Recordatorio enviado correctamente' };
    } else {
      return { exito: false, mensaje: `Error al enviar: ${response.text}` };
    }
  } catch (error) {
    console.error('Error al enviar recordatorio:', error);
    return { exito: false, mensaje: `Error: ${error}` };
  }
}

/**
 * Envía un email de alerta de evento
 */
export async function enviarAlertaEvento(datos: DatosAlerta): Promise<{ exito: boolean; mensaje: string }> {
  if (!inicializado) {
    const init = await inicializarEmail();
    if (!init) {
      return { exito: false, mensaje: 'El servicio de email no está configurado' };
    }
  }

  try {
    const config = await obtenerConfiguracionEmail();

    // Usar plantilla de alerta o la de recordatorio como fallback
    const templateId = config.templateIdAlerta || config.templateIdRecordatorio;

    if (!templateId) {
      return { exito: false, mensaje: 'No hay plantilla de email configurada' };
    }

    const tiempoTexto = datos.minutosRestantes <= 60
      ? `${datos.minutosRestantes} minutos`
      : `${Math.round(datos.minutosRestantes / 60)} horas`;

    const templateParams = {
      to_email: config.emailDestino,
      to_name: config.nombreUsuario || 'Usuario',
      expediente: datos.expediente,
      juzgado: datos.juzgado,
      tipo_evento: datos.tipoEvento,
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      fecha_evento: datos.fechaEvento,
      tiempo_restante: tiempoTexto,
      app_name: 'TSJ Filing Online'
    };

    const response = await emailjs.send(
      config.serviceId,
      templateId,
      templateParams
    );

    if (response.status === 200) {
      return { exito: true, mensaje: 'Alerta enviada correctamente' };
    } else {
      return { exito: false, mensaje: `Error al enviar: ${response.text}` };
    }
  } catch (error) {
    console.error('Error al enviar alerta:', error);
    return { exito: false, mensaje: `Error: ${error}` };
  }
}

/**
 * Envía un email de prueba para verificar la configuración
 */
export async function enviarEmailPrueba(): Promise<{ exito: boolean; mensaje: string }> {
  if (!inicializado) {
    const init = await inicializarEmail();
    if (!init) {
      return { exito: false, mensaje: 'El servicio de email no está configurado' };
    }
  }

  try {
    const config = await obtenerConfiguracionEmail();
    const templateId = config.templateIdRecordatorio || config.templateIdAlerta;

    if (!templateId) {
      return { exito: false, mensaje: 'No hay plantilla de email configurada' };
    }

    const templateParams = {
      to_email: config.emailDestino,
      to_name: config.nombreUsuario || 'Usuario',
      expediente: 'PRUEBA-2025',
      juzgado: 'Juzgado de Prueba',
      titulo: 'Email de Prueba',
      descripcion: 'Este es un email de prueba para verificar la configuración del servicio de notificaciones.',
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX'),
      app_name: 'TSJ Filing Online'
    };

    const response = await emailjs.send(
      config.serviceId,
      templateId,
      templateParams
    );

    if (response.status === 200) {
      return { exito: true, mensaje: `Email de prueba enviado a ${config.emailDestino}` };
    } else {
      return { exito: false, mensaje: `Error: ${response.text}` };
    }
  } catch (error) {
    console.error('Error al enviar email de prueba:', error);
    return { exito: false, mensaje: `Error: ${error}` };
  }
}

// ============== PLANTILLAS POR DEFECTO ==============

/**
 * Obtiene el HTML de ejemplo para crear plantillas en EmailJS
 */
export function obtenerPlantillaEjemplo(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #366092; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .expediente { background: #e8f4fd; padding: 15px; border-left: 4px solid #366092; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚖️ TSJ Filing Online</h1>
      <p>Sistema de Gestión de Expedientes</p>
    </div>
    <div class="content">
      <p>Hola {{to_name}},</p>
      <p>{{titulo}}</p>
      <div class="expediente">
        <strong>Expediente:</strong> {{expediente}}<br>
        <strong>Juzgado:</strong> {{juzgado}}<br>
        <strong>Fecha:</strong> {{fecha}} a las {{hora}}
      </div>
      <p>{{descripcion}}</p>
    </div>
    <div class="footer">
      <p>Este mensaje fue enviado desde {{app_name}}</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Instrucciones para configurar EmailJS
 */
export const INSTRUCCIONES_EMAILJS = `
## Configuración de EmailJS (Gratuito - 200 emails/mes)

### Paso 1: Crear cuenta
1. Ve a https://www.emailjs.com/
2. Crea una cuenta gratuita

### Paso 2: Agregar servicio de email
1. En el dashboard, ve a "Email Services"
2. Haz clic en "Add New Service"
3. Selecciona tu proveedor (Gmail, Outlook, etc.)
4. Sigue las instrucciones para conectar tu cuenta
5. Copia el "Service ID" (ej: service_abc123)

### Paso 3: Crear plantilla
1. Ve a "Email Templates"
2. Haz clic en "Create New Template"
3. Diseña tu plantilla usando las variables:
   - {{to_email}} - Email destino
   - {{to_name}} - Nombre del usuario
   - {{expediente}} - Número de expediente
   - {{juzgado}} - Nombre del juzgado
   - {{titulo}} - Título del recordatorio
   - {{descripcion}} - Descripción
   - {{fecha}} - Fecha
   - {{hora}} - Hora
4. Guarda y copia el "Template ID" (ej: template_xyz789)

### Paso 4: Obtener Public Key
1. Ve a "Account" > "API Keys"
2. Copia la "Public Key"

### Paso 5: Configurar en la app
1. Ve a Configuración > Email
2. Ingresa el Service ID, Template ID y Public Key
3. Ingresa tu email de destino
4. Haz clic en "Enviar email de prueba"
`;
