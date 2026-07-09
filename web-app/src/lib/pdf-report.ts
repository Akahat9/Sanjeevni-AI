"use client";

export type ReportReading = {
  label: string;
  value: string;
  reference: string;
  status?: "Normal" | "Low" | "High" | "Unavailable";
};

export type HealthReportOptions = {
  filename: string;
  title: string;
  subtitle: string;
  metadata: Array<[string, string]>;
  readings: ReportReading[];
  aiText: string;
  disclaimer: string;
  profile?: { name: string; photoURL?: string | null };
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function parseAiSections(text: string) {
  const cleaned = text.trim();
  if (!cleaned) return [{ heading: "AI analysis", content: "AI analysis was not available." }];
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = "Summary";
  let content: string[] = [];
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^#{1,4}\s+(.+)$/);
    if (match) {
      if (content.join("\n").trim()) sections.push({ heading, content: content.join("\n").trim() });
      heading = match[1].replace(/\*\*/g, "");
      content = [];
    } else {
      content.push(line.replace(/\*\*/g, ""));
    }
  }
  if (content.join("\n").trim()) sections.push({ heading, content: content.join("\n").trim() });
  return sections.length ? sections : [{ heading: "Summary", content: cleaned.replace(/[#*]/g, "") }];
}

export async function downloadHealthReport(options: HealthReportOptions) {
  const root = element("section", "health-pdf");
  root.setAttribute("aria-hidden", "true");
  root.style.position = "fixed";
  root.style.left = "-10000px";
  root.style.top = "0";
  root.style.width = "794px";
  root.style.background = "#ffffff";
  root.style.color = "#162033";
  root.style.padding = "46px";
  root.style.fontFamily = "Inter, 'Noto Sans Devanagari', 'Nirmala UI', Arial, sans-serif";

  const style = element("style");
  style.textContent = `
    .health-pdf *{box-sizing:border-box}
    .pdf-brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}
    .pdf-profile{margin-left:auto;display:flex;align-items:center;gap:9px;text-align:right}.pdf-profile img,.pdf-profile-avatar{width:38px;height:38px;border-radius:12px;object-fit:cover;background:#ece9ff;display:grid;place-items:center;color:#6548ef;font-weight:900}.pdf-profile strong{display:block;font-size:10px}.pdf-profile small{font-size:8px;color:#788399}
    .pdf-logo{width:45px;height:45px;border-radius:14px;background:linear-gradient(135deg,#6548ef,#9d58f4);color:white;display:grid;place-items:center;font-size:22px;font-weight:900}
    .pdf-brand strong{display:block;font-size:17px}.pdf-brand small{display:block;color:#788399;font-size:10px;margin-top:2px}
    .pdf-hero{padding:24px;border-radius:18px;background:linear-gradient(120deg,#f1edff,#f8f7ff);border:1px solid #ded7ff;margin-bottom:20px}
    .pdf-hero h1{margin:0;font-size:27px;letter-spacing:-.5px}.pdf-hero p{margin:8px 0 0;color:#68748b;font-size:11px;line-height:1.6}
    .pdf-meta{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:22px}
    .pdf-meta div{padding:10px 12px;border:1px solid #e5e8ef;border-radius:10px;background:#fafbfc}
    .pdf-meta span{display:block;color:#8a94a6;font-size:8px;text-transform:uppercase;letter-spacing:.7px}.pdf-meta strong{display:block;margin-top:4px;font-size:10px}
    .pdf-section-title{margin:22px 0 10px;font-size:15px}
    .pdf-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dfe3eb;border-radius:12px;overflow:hidden}
    .pdf-table th{padding:10px;background:#f3f1ff;color:#61547e;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.5px}
    .pdf-table td{padding:11px 10px;border-top:1px solid #e8eaf0;font-size:10px;vertical-align:middle}.pdf-table td:first-child{font-weight:700}
    .pdf-status{display:inline-block;padding:4px 7px;border-radius:99px;font-size:8px;font-weight:800}
    .pdf-status.normal{color:#12835a;background:#dff7ec}.pdf-status.high,.pdf-status.low{color:#b54155;background:#ffe5e9}.pdf-status.unavailable{color:#7b8495;background:#edf0f5}
    .pdf-ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .pdf-ai-card{padding:15px;border:1px solid #e1e5ed;border-radius:12px;background:#fbfcfe;break-inside:avoid}
    .pdf-ai-card h3{margin:0 0 7px;color:#6548ef;font-size:12px}.pdf-ai-card p{white-space:pre-wrap;margin:0;color:#4d596e;font-size:10px;line-height:1.65}
    .pdf-disclaimer{margin-top:22px;padding:12px 14px;border-left:4px solid #f2a23f;background:#fff8ec;color:#6c5a3e;font-size:9px;line-height:1.6}
    .pdf-footer{margin-top:25px;padding-top:11px;border-top:1px solid #e4e7ed;display:flex;justify-content:space-between;color:#929aaa;font-size:8px}
  `;
  root.appendChild(style);

  const brand = element("div", "pdf-brand");
  brand.appendChild(element("div", "pdf-logo", "♥"));
  const brandText = element("div");
  brandText.appendChild(element("strong", "", "Sanjeevni-AI Health"));
  brandText.appendChild(element("small", "", "Responsible health intelligence"));
  brand.appendChild(brandText);
  if (options.profile) {
    const profile = element("div", "pdf-profile");
    const identity = element("div");
    identity.appendChild(element("strong", "", options.profile.name));
    identity.appendChild(element("small", "", "Authenticated patient"));
    profile.appendChild(identity);
    if (options.profile.photoURL) {
      const photo = element("img");
      photo.src = options.profile.photoURL;
      photo.crossOrigin = "anonymous";
      profile.appendChild(photo);
    } else {
      profile.appendChild(element("div", "pdf-profile-avatar", options.profile.name.slice(0, 1).toUpperCase()));
    }
    brand.appendChild(profile);
  }
  root.appendChild(brand);

  const hero = element("div", "pdf-hero");
  hero.appendChild(element("h1", "", options.title));
  hero.appendChild(element("p", "", options.subtitle));
  root.appendChild(hero);

  const metadata = element("div", "pdf-meta");
  for (const [label, value] of options.metadata) {
    const item = element("div");
    item.appendChild(element("span", "", label));
    item.appendChild(element("strong", "", value));
    metadata.appendChild(item);
  }
  root.appendChild(metadata);

  root.appendChild(element("h2", "pdf-section-title", "Diagnostic readings"));
  const table = element("table", "pdf-table");
  const thead = element("thead");
  const header = element("tr");
  for (const label of ["Test", "Your value", "Reference range", "Status"]) header.appendChild(element("th", "", label));
  thead.appendChild(header);
  table.appendChild(thead);
  const tbody = element("tbody");
  for (const reading of options.readings) {
    const row = element("tr");
    row.appendChild(element("td", "", reading.label));
    row.appendChild(element("td", "", reading.value));
    row.appendChild(element("td", "", reading.reference));
    const statusCell = element("td");
    const status = reading.status || "Unavailable";
    statusCell.appendChild(element("span", `pdf-status ${status.toLowerCase()}`, status));
    row.appendChild(statusCell);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  root.appendChild(element("h2", "pdf-section-title", "AI summary, suggestions, and advice"));
  const aiGrid = element("div", "pdf-ai-grid");
  for (const section of parseAiSections(options.aiText)) {
    const card = element("article", "pdf-ai-card");
    card.appendChild(element("h3", "", section.heading));
    card.appendChild(element("p", "", section.content));
    aiGrid.appendChild(card);
  }
  root.appendChild(aiGrid);
  root.appendChild(element("div", "pdf-disclaimer", options.disclaimer));
  const footer = element("div", "pdf-footer");
  footer.appendChild(element("span", "", `Generated ${new Date().toLocaleString("en-IN")}`));
  footer.appendChild(element("span", "", "Sanjeevni-AI · Educational use only"));
  root.appendChild(footer);
  document.body.appendChild(root);

  try {
    await document.fonts.ready;
    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true });
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 8;
    const drawWidth = pageWidth - margin * 2;
    const pagePixelHeight = Math.floor(canvas.width * ((pageHeight - margin * 2) / drawWidth));
    let offset = 0;
    let page = 0;
    while (offset < canvas.height) {
      const sliceHeight = Math.min(pagePixelHeight, canvas.height - offset);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const context = slice.getContext("2d");
      if (!context) throw new Error("Could not create PDF page");
      context.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (page > 0) pdf.addPage();
      const drawHeight = (sliceHeight / canvas.width) * drawWidth;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.94), "JPEG", margin, margin, drawWidth, drawHeight);
      offset += sliceHeight;
      page += 1;
    }
    pdf.save(options.filename);
  } finally {
    root.remove();
  }
}
