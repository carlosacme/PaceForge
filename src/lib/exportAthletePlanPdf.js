import { jsPDF } from "jspdf";
import {
  BRAND_NAME,
  WORKOUT_TYPES,
  formatLocalYMD,
  computeHrZones,
} from "../components/shared/appShared";

const PDF_WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

const pdfWeekdayFromYmd = (ymd) => {
  const t = new Date(`${ymd}T12:00:00`).getTime();
  if (Number.isNaN(t)) return "—";
  return PDF_WEEKDAY_SHORT[new Date(t).getDay()];
};

const getCurrentMonthYmdRange = () => {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const p2 = (n) => String(n).padStart(2, "0");
  const start = `${y}-${p2(mo + 1)}-01`;
  const lastD = new Date(y, mo + 1, 0).getDate();
  const end = `${y}-${p2(mo + 1)}-${p2(lastD)}`;
  const label = now.toLocaleDateString("es", { month: "long", year: "numeric" });
  return { start, end, label };
};

const sanitizePdfFilenamePart = (s) => {
  const base = (s || "atleta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  return base || "atleta";
};

/** Plan del atleta: mes calendario actual, footer en todas las páginas. */
export const exportAthletePlanToPdf = ({ athlete, workouts, coachDisplayName }) => {
  const { start, end, label: monthLabel } = getCurrentMonthYmdRange();
  const monthWorkouts = workouts
    .filter((w) => w.scheduled_date >= start && w.scheduled_date <= end)
    .sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date);
      return String(a.id).localeCompare(String(b.id));
    });

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 14;
  const R = 14;
  let y = 14;
  const coach = (coachDisplayName && String(coachDisplayName).trim()) || "Coach";
  const genStamp = `${formatLocalYMD(new Date())} ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;

  const checkPage = (needMm = 10) => {
    if (y + needMm > pageH - 18) {
      doc.addPage();
      y = 14;
    }
  };

  // Colores por tipo de workout
  const TYPE_COLORS = {
    easy:       [34, 197, 94],
    recovery:   [134, 239, 172],
    long:       [59, 130, 246],
    tempo:      [249, 115, 22],
    interval:   [239, 68, 68],
    race:       [168, 85, 247],
    strength:   [255, 138, 61],
    rest:       [148, 163, 184],
  };
  const getTypeColor = (type) => TYPE_COLORS[type] || [100, 116, 139];

  // ── HEADER ────────────────────────────────────────────────────
  // Barra naranja izquierda
  doc.setFillColor(255, 138, 61);
  doc.rect(0, 0, 4, pageH, "F");

  // Logo area
  doc.setFillColor(255, 138, 61);
  doc.roundedRect(L, y - 3, 8, 8, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text("RAF", L + 1.5, y + 2.5);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.text(BRAND_NAME, L + 11, y + 3);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text("COACH PLATFORM", L + 11, y + 8);

  // Línea separadora header
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(L, y + 12, pageW - R, y + 12);
  y += 18;

  // ── TÍTULO DEL PLAN ──────────────────────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(L, y - 3, pageW - L - R, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.text(`Plan mensual — ${monthLabel}`, L + 4, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(`Coach: ${coach}`, L + 4, y + 10);
  y += 22;

  // ── DATOS DEL ATLETA ─────────────────────────────────────────
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(253, 230, 138);
  doc.setLineWidth(0.3);
  doc.roundedRect(L, y - 3, pageW - L - R, 26, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setTextColor(180, 83, 9);
  doc.setFontSize(7);
  doc.text("ATLETA", L + 4, y + 2);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.text(String(athlete.name || "—"), L + 4, y + 8);

  // Grid de datos
  const dataItems = [
    ["Objetivo", String(athlete.goal || "—")],
    ["Ritmo /km", String(athlete.pace || "—")],
    ["Km/semana", athlete.weekly_km != null ? `${athlete.weekly_km} km` : "—"],
  ];
  const colW = (pageW - L - R - 8) / 3;
  dataItems.forEach(([label, val], i) => {
    const x = L + 4 + i * colW;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), x, y + 15);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    const val2 = doc.splitTextToSize(val, colW - 4);
    doc.text(val2[0] || val, x, y + 20);
  });
  y += 32;

  // ── RESUMEN KM DEL MES ───────────────────────────────────────
  const totalKm = monthWorkouts.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
  const totalMin = monthWorkouts.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
  const doneCount = monthWorkouts.filter((w) => w.done).length;
  const totalCount = monthWorkouts.length;

  const summaryItems = [
    ["Sesiones", `${totalCount}`],
    ["Completadas", `${doneCount}/${totalCount}`],
    ["Km totales", `${totalKm.toFixed(1)} km`],
    ["Tiempo total", `${Math.floor(totalMin / 60)}h ${totalMin % 60}min`],
  ];

  checkPage(18);
  doc.setFillColor(240, 253, 250);
  doc.setDrawColor(167, 243, 208);
  doc.setLineWidth(0.3);
  doc.roundedRect(L, y - 3, pageW - L - R, 16, 2, 2, "FD");

  const sColW = (pageW - L - R - 8) / summaryItems.length;
  summaryItems.forEach(([label, val], i) => {
    const x = L + 4 + i * sColW;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), x, y + 2);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(13, 148, 136);
    doc.setFontSize(11);
    doc.text(val, x, y + 9);
  });
  y += 22;

  // ── TABLA DE WORKOUTS ────────────────────────────────────────
  checkPage(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text("Entrenamientos del mes", L, y);
  y += 7;

  // Header tabla
  doc.setFillColor(15, 23, 42);
  doc.rect(L, y - 4, pageW - L - R, 7, "F");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");

  const xStatus = L + 2;
  const xDate2 = L + 8;
  const xDay2 = L + 30;
  const xTitle2 = L + 40;
  const xType2 = L + 108;
  const xKm2 = L + 144;
  const xMin2 = L + 160;

  doc.text("", xStatus, y);
  doc.text("Fecha", xDate2, y);
  doc.text("Dia", xDay2, y);
  doc.text("Titulo", xTitle2, y);
  doc.text("Tipo", xType2, y);
  doc.text("Km", xKm2, y);
  doc.text("Min", xMin2, y);
  y += 5;

  if (monthWorkouts.length === 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.text("No hay entrenamientos programados en este mes.", L + 4, y + 5);
    y += 12;
  } else {
    let rowIndex = 0;
    for (const w of monthWorkouts) {
      const typeLabel = WORKOUT_TYPES.find((t) => t.id === w.type)?.label || w.type || "—";
      const titleLines = doc.splitTextToSize(String(w.title || "—"), 64);
      const rowH = Math.max(5, titleLines.length * 4.5);
      checkPage(rowH + 3);

      // Fila alterna
      if (rowIndex % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(L, y - 4, pageW - L - R, rowH + 2, "F");
      }

      // Indicador de tipo (barra de color izquierda)
      const [r, g, b] = getTypeColor(w.type);
      doc.setFillColor(r, g, b);
      doc.rect(L, y - 4, 3, rowH + 2, "F");

      // Check si completado
      if (w.done) {
        doc.setTextColor(34, 197, 94);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text("Hecho", xStatus + 4, y);
      }

      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 30);
      doc.text(w.scheduled_date, xDate2, y);
      doc.text(pdfWeekdayFromYmd(w.scheduled_date), xDay2, y);
      doc.text(titleLines, xTitle2, y);

      // Badge tipo
      doc.setFillColor(r, g, b);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(6);
      doc.setFont("helvetica", "bold");
      const typeW = doc.getTextWidth(typeLabel) + 4;
      doc.roundedRect(xType2, y - 3, typeW, 4.5, 1, 1, "F");
      doc.text(typeLabel, xType2 + 2, y);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(7.5);
      doc.text(String(w.total_km ?? 0), xKm2, y);
      doc.text(String(w.duration_min ?? 0), xMin2, y);

      // RPE si existe
      if (w.rpe) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(6);
        doc.text(`RPE ${w.rpe}`, xMin2 + 12, y);
      }

      y += rowH + 2;
      rowIndex++;
    }
  }

  // ── ZONAS FC ─────────────────────────────────────────────────
  const { zones, method: hrZonesMethod } = computeHrZones(athlete.fc_max, athlete.fc_reposo);
  if (zones.length) {
    y += 6;
    checkPage(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("Zonas de Frecuencia Cardiaca", L, y);
    y += 6;

    const zoneColors = [
      [134, 239, 172], [52, 211, 153], [59, 130, 246],
      [249, 115, 22], [239, 68, 68],
    ];
    const zColW = (pageW - L - R) / zones.length;

    zones.forEach((z, i) => {
      const [zr, zg, zb] = zoneColors[i] || [148, 163, 184];
      const x = L + i * zColW;
      doc.setFillColor(zr, zg, zb);
      doc.roundedRect(x, y - 3, zColW - 2, 18, 2, 2, "F");

      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.text(`Z${z.zone}`, x + 3, y + 2);
      doc.setFontSize(6.5);
      doc.text(z.label, x + 3, y + 7);
      doc.setFontSize(7);
      doc.text(`${z.low}-${z.high} lpm`, x + 3, y + 12);
    });
    y += 24;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      hrZonesMethod === "karvonen"
        ? `Metodo Karvonen (FC reserva) - FC max ${athlete.fc_max} lpm, FC reposo ${athlete.fc_reposo} lpm`
        : `Calculadas sobre FC max ${athlete.fc_max} lpm. Registra la FC en reposo para zonas mas precisas.`,
      L,
      y,
    );
  }

  // ── FOOTER EN TODAS LAS PÁGINAS ──────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(255, 138, 61);
    doc.rect(0, pageH - 12, 4, 12, "F");
    doc.setFontSize(7);
    doc.setTextColor(110, 110, 110);
    doc.setFont("helvetica", "normal");
    doc.text(`Generado: ${genStamp}  ·  Coach: ${coach}  ·  Pagina ${i} de ${totalPages}`, L, pageH - 5);
  }

  const fname = `Plan_${sanitizePdfFilenamePart(athlete.name)}_${formatLocalYMD(new Date())}.pdf`;
  doc.save(fname);
};
