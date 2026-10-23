export function getAccountMenuText(): string {
  return [
    "📄 *TRÁMITES, ESTADO DE CUENTA Y CARNET DIGITAL* 📄",
    "",
    "Elige una opción respondiendo con su número:",
    "6.1 🪪 *¿Cómo descargar mi Carnet Digital con QR?*",
    "6.2 🔄 *Renovar mi Afiliación Anual*",
    "6.3 🏍️ *Actualizar datos o registrar una nueva motocicleta*",
    "6.4 🧾 *Facturación Electrónica y Certificados*",
    "0 ⬅️ *Volver al Menú Principal*",
    "* 🛎️ *Hablar con un Asesor en Vivo*",
  ].join("\n");
}

export function getAccountCarnetText(): string {
  return [
    "🪪 *CARNET DIGITAL BSKMT*",
    "",
    "Tu carnet digital está disponible 24/7 en tu portal de miembro:",
    "1. Inicia sesión en: https://panel.bskmt.com",
    "2. Ve a la sección *Carnet Digital* o ingresa directo a: https://panel.bskmt.com/carnet",
    "3. Podrás ver tu carnet con código QR dinámico, tipo de sangre, contacto de emergencia y fecha de vigencia.",
    "4. Puedes guardarlo en tu billetera digital (Apple Wallet / Google Wallet) o descargarlo en PDF.",
    "",
    "---",
    "💡 _Escribe *0* para el menú principal, o *ASESOR* si necesitas ayuda con tu carnet._",
  ].join("\n");
}

export function getAccountRenewText(): string {
  return [
    "🔄 *RENOVACIÓN DE AFILIACIÓN ANUAL*",
    "",
    "Mantén activos tus beneficios, cobertura vial ARPHA y descuentos:",
    "1. Ingresa a: https://panel.bskmt.com/renovacion",
    "2. Verifica tu plan y confirma tus datos de contacto.",
    "3. Cancela mediante PSE o tarjeta con tarifa preferencial de renovación.",
    "",
    "---",
    "💡 _Escribe *0* para volver al menú, o *ASESOR* para consultar tu fecha límite de vigencia._",
  ].join("\n");
}

export function getAccountGarageText(): string {
  return [
    "🏍️ *GARAGE VIRTUAL Y ACTUALIZACIÓN DE MOTOS*",
    "",
    "En tu portal puedes gestionar tu flota personal:",
    "• Registrar cambio de motocicleta (marca, modelo, placa y color).",
    "• Actualizar fechas de vencimiento de SOAT y Tecnomecánica para recibir recordatorios automáticos.",
    "• Enlace directo: https://panel.bskmt.com/garage",
    "",
    "---",
    "💡 _Escribe *0* para el menú, o *ASESOR* para asistencia en la plataforma._",
  ].join("\n");
}

export function getAccountBillingText(): string {
  return [
    "🧾 *FACTURACIÓN ELECTRÓNICA Y CERTIFICADOS*",
    "",
    "Todas nuestras transacciones cuentan con facturación electrónica DIAN generada automáticamente vía Alegra:",
    "• Puedes consultar y descargar tus facturas y certificados de afiliación en: https://panel.bskmt.com/facturacion",
    "• Si requieres una factura a nombre de empresa o NIT, envíanos el RUT actualizado escribiendo la palabra *ASESOR*.",
    "",
    "---",
    "💡 _Escribe *0* para el menú principal, o *ASESOR* para hablar con facturación._",
  ].join("\n");
}
