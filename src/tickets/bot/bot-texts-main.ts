export function getMainMenuText(name: string): string {
  return [
    "🏍️ *BSK MOTORCYCLE TEAM — ATENCIÓN AL CLIENTE* 🏍️",
    "_Comunidad, Pasión y Respaldo Motero_",
    "",
    `¡Hola ${name || "Compañero Motero"}! 👋 Soy tu asistente virtual de BSKMT. Estoy listo para ayudarte a resolver tus consultas de inmediato las 24 horas del día.`,
    "",
    "Por favor responde con el *NÚMERO* de tu opción:",
    "",
    "1️⃣ *Membresías Legend BSKMT* (Beneficios, planes, costos y cómo unirte)",
    "2️⃣ *Rodadas y Calendario Oficial* (Rutas, puntos de encuentro y seguridad)",
    "3️⃣ *Academia Ready To Ride* (Cursos de conducción y mecánica en ruta)",
    "4️⃣ *Red de Asistencia Vial ARPHA* (Auxilio mecánico y grúa 24/7 en carretera)",
    "5️⃣ *Tienda Oficial & Merchandising* (Chaquetas, impermeables y accesorios)",
    "6️⃣ *Trámites, Estado de Cuenta y Carnet Digital*",
    "7️⃣ *Sede Física, Horarios y Preguntas Frecuentes*",
    "0️⃣ *Hablar con un Asesor en Vivo* (Atención personalizada en sede)",
    "",
    "_Escribe el número correspondiente para continuar._",
  ].join("\n");
}

export function getDefaultFallbackText(): string {
  return [
    "🤔 No logré identificar esa opción.",
    "",
    "Por favor responde con el *NÚMERO* del tema que deseas consultar:",
    "1️⃣ *Membresías Legend BSKMT* (Beneficios, planes y afiliación)",
    "2️⃣ *Rodadas y Calendario* (Rutas, puntos de encuentro y fechas)",
    "3️⃣ *Academia Ready To Ride* (Cursos de conducción y mecánica)",
    "4️⃣ *Red de Auxilio Vial ARPHA* (Grúa 24/7 y asistencia mecánica)",
    "5️⃣ *Tienda Oficial BSKMT* (Prendas y accesorios)",
    "6️⃣ *Trámites, Estado de Cuenta y Carnet Digital*",
    "7️⃣ *Sede Física y Preguntas Frecuentes*",
    "",
    "O también puedes escribir:",
    "• *MENU* para ver el menú principal",
    "• *ASESOR* si deseas ser transferido con un asesor humano en vivo",
  ].join("\n");
}

export function getEscalationReplyText(customerName: string): string {
  return [
    "🛎️ *SOLICITUD DE ASESOR EN VIVO CONECTADA* 🛎️",
    "",
    `¡Hola ${customerName}! Tu conversación ha sido transferida directamente a nuestra *Mesa de Gestión en Sede BSKMT*.`,
    "",
    "Un gestor de atención al cliente se ha conectado a tu chat y te responderá por este mismo canal en breves momentos.",
    "",
    "✍️ _Por favor describe con el mayor detalle posible tu solicitud, duda o consulta mientras tu asesor toma el caso._",
  ].join("\n");
}
