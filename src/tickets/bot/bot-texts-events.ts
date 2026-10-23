export function getEventsMenuText(): string {
  return [
    "🏁 *RODADAS Y CALENDARIO OFICIAL BSKMT* 🏁",
    "_Rutas planeadas con la mejor logística, seguridad y compañerismo_",
    "",
    "Elige una opción respondiendo con su número:",
    "2.1 📅 *Próxima Rodada del Mes* (Ruta, fecha, hora y nivel de dificultad)",
    "2.2 📍 *Puntos de Salida y Encuentro* (Norte, Calle 80 y Autopista Sur)",
    "2.3 📋 *Requisitos Obligatorios para Rodar* (Checklist de seguridad vial)",
    "2.4 👥 *Rodadas Abiertas vs Rodadas Exclusivas Legend*",
    "2.5 🛡️ *Protocolo de Seguridad y Capitanes de Ruta*",
    "0 ⬅️ *Volver al Menú Principal*",
    "* 🛎️ *Hablar con un Asesor en Vivo*",
  ].join("\n");
}

export function getUpcomingEventText(): string {
  return [
    "📅 *PRÓXIMA RODADA EN CALENDARIO BSKMT*",
    "",
    "🏍️ *Ruta*: Bogotá - Guatavita - Represa del Sisga - Sesquilé.",
    "🗓️ *Fecha*: Este domingo (Consulta horario en calendario web).",
    "⏰ *Hora de encuentro*: 6:30 AM | *Hora de salida*: 7:00 AM puntual.",
    "📍 *Punto de inicio*: Estación Primax Autopista Norte con Calle 224.",
    "🎯 *Nivel de dificultad*: Intermedio - Pavimento 100% en buen estado.",
    "🥪 *Actividades*: Desayuno grupal, fotografía profesional en ruta y rifas de aliados.",
    "",
    "Consulta el calendario completo actualizado en:",
    "👉 https://bskmt.com/eventos",
    "",
    "---",
    "💡 _Escribe *2.2* para ver otros puntos de encuentro, *0* para volver al menú, o *ASESOR* para atención en vivo._",
  ].join("\n");
}

export function getMeetingPointsText(): string {
  return [
    "📍 *PUNTOS DE ENCUENTRO OFICIALES EN BOGOTÁ*",
    "",
    "Dependiendo de la dirección de la ruta, utilizamos 3 puntos estratégicos:",
    "• 🏔️ *Salida Norte*: Estación Primax / Texaco Autopista Norte (Calle 224, sentido Sur-Norte).",
    "• 🌄 *Salida Occidente (Calle 80)*: Estación Terpel Siberia (Glorieta La Florida).",
    "• 🏞️ *Salida Sur*: Estación Petrobras Chusacá / Soacha (Pasando peaje).",
    "",
    "⚠️ *Importante*: Llegar con tanque de combustible 100% lleno y presión de llantas calibrada.",
    "",
    "---",
    "💡 _Escribe *0* para regresar al menú principal, o *ASESOR* para resolver tus dudas._",
  ].join("\n");
}

export function getEventRequirementsText(): string {
  return [
    "📋 *CHECKLIST OBLIGATORIO PARA RODAR CON BSKMT*",
    "",
    "Por tu seguridad y la del grupo, antes de partir verificamos:",
    "1. Casco reglamentario certificado (DOT / ECE 22.05 o 22.06) abrochado.",
    "2. Chaqueta con protecciones y guantes de motociclismo.",
    "3. Documentos vigentes: SOAT, Tecnomecánica y Licencia A2 física o digital en RUNT.",
    "4. Motocicleta en óptimas condiciones (luces, frenos y kit de arrastre).",
    "5. Impermeable a la mano.",
    "",
    "---",
    "💡 _Escribe *0* para el menú principal, o *ASESOR* si requieres información adicional._",
  ].join("\n");
}

export function getEventTypesText(): string {
  return [
    "👥 *MODALIDADES DE RODADAS BSKMT*",
    "",
    "• 🟢 *Rodadas Abiertas*: Para toda la comunidad motera (miembros y no miembros). Perfectas para conocernos, integrarse y disfrutar de una mañana de ruta segura.",
    "• 🟡 *Rodadas Legend (Privadas)*: Exclusivas para miembros afiliados. Incluyen viajes de varios días (ej: Eje Cafetero, Desierto de la Tatacoa, Santanderes), carro barredora, paramédico y reservas hoteleras grupales.",
    "",
    "---",
    "💡 _Escribe *0* para el menú principal, o *ASESOR* para hablar en vivo._",
  ].join("\n");
}

export function getEventSecurityText(): string {
  return [
    "🛡️ *SEGURIDAD Y DISCIPLINA EN RUTA*",
    "",
    "Nuestras rodadas cuentan con un estricto protocolo de caravana:",
    "• 🏍️ *Líder de Ruta*: Marca el ritmo de marcha respetando los límites legales de velocidad.",
    "• 🚩 *Bloqueadores*: Aseguran glorietas e intersecciones para paso seguro del grupo.",
    "• 🚑 *Barredora / Cierre*: Motocicleta equipada con herramientas, botiquín y comunicación radial que rueda al final del grupo.",
    "• ❌ *Prohibido*: Piques, maniobras peligrosas, sobrepasos por la derecha dentro de la caravana o consumo de alcohol.",
    "",
    "---",
    "💡 _Escribe *0* para volver al menú, o *ASESOR* para hablar con un gestor._",
  ].join("\n");
}
