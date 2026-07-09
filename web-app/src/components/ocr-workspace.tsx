"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
  FileImage,
  LoaderCircle,
  MessageCircleHeart,
  RefreshCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Volume2,
} from "lucide-react";
import { downloadHealthReport, ReportReading } from "@/lib/pdf-report";
import { User } from "firebase/auth";
import { get, ref } from "firebase/database";
import { getRealtimeDatabase } from "@/lib/firebase";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:5100"
).replace(/\/+$/, "");

const medicalTerms = [
  "glucose",
  "hemoglobin",
  "cholesterol",
  "bilirubin",
  "platelet",
  "creatinine",
  "blood pressure",
  "heart rate",
  "diagnosis",
  "positive",
  "negative",
  "abnormal",
];

type ReferenceTest = {
  name: string;
  aliases: string[];
  min?: number;
  max?: number;
  range: string;
  unit: string;
};

const referenceTests: ReferenceTest[] = [
  {
    name: "Fasting glucose",
    aliases: ["fasting glucose", "fasting blood sugar", "fbs"],
    max: 99,
    range: "≤ 99",
    unit: "mg/dL",
  },
  {
    name: "HbA1c",
    aliases: ["hba1c", "a1c", "glycated hemoglobin"],
    max: 5.6,
    range: "< 5.7",
    unit: "%",
  },
  {
    name: "Total cholesterol",
    aliases: ["total cholesterol", "cholesterol total"],
    max: 199,
    range: "< 200",
    unit: "mg/dL",
  },
  {
    name: "LDL cholesterol",
    aliases: ["ldl cholesterol", "ldl-c", "ldl"],
    max: 99,
    range: "< 100",
    unit: "mg/dL",
  },
  {
    name: "HDL cholesterol",
    aliases: ["hdl cholesterol", "hdl-c", "hdl"],
    min: 40,
    range: "≥ 40",
    unit: "mg/dL",
  },
  {
    name: "Heart rate",
    aliases: ["heart rate", "pulse rate", "pulse"],
    min: 60,
    max: 100,
    range: "60–100",
    unit: "bpm",
  },
  {
    name: "Systolic BP",
    aliases: ["systolic", "systolic bp"],
    max: 119,
    range: "< 120",
    unit: "mmHg",
  },
  {
    name: "Diastolic BP",
    aliases: ["diastolic", "diastolic bp"],
    max: 79,
    range: "< 80",
    unit: "mmHg",
  },
];

function extractComparisons(text: string) {
  return referenceTests.flatMap((test) => {
    for (const alias of test.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(
        new RegExp(
          `${escaped}\\s*(?:result|value)?\\s*[:=\\-]?\\s*(\\d+(?:\\.\\d+)?)`,
          "i",
        ),
      );
      if (!match) continue;
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      const status =
        test.min !== undefined && value < test.min
          ? "Low"
          : test.max !== undefined && value > test.max
            ? "High"
            : "Normal";
      return [{ ...test, value, status }];
    }
    return [];
  });
}

function analyzeReport(text: string) {
  const lower = text.toLowerCase();
  const keywords = medicalTerms.filter((term) => lower.includes(term));
  const urgent = [
    "critical",
    "malignant",
    "positive",
    "severe",
    "emergency",
  ].filter((term) => lower.includes(term));
  const caution = ["high", "low", "abnormal", "elevated"].filter((term) =>
    lower.includes(term),
  );
  const severity = urgent.length ? "High" : caution.length ? "Moderate" : "Low";
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  return {
    keywords,
    severity,
    summary: sentences || "Run OCR to generate a concise report overview.",
    recommendation: urgent.length
      ? "Potentially important findings were detected. Arrange prompt review by a qualified clinician."
      : caution.length
        ? "Some values may need clinical context. Discuss the original report with your healthcare provider."
        : "No obvious warning language was detected. A clinician should still verify the original report.",
  };
}

function cleanExtractedText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim().replace(/\s+([,:;%])/g, "$1"))
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pdfItemsToReadableText(
  items: Array<{ str?: string; transform?: number[] }>,
) {
  const rows = new Map<number, Array<{ x: number; text: string }>>();
  for (const item of items) {
    const text = item.str?.trim();
    if (!text) continue;
    const x = item.transform?.[4] ?? 0;
    const y = Math.round((item.transform?.[5] ?? 0) / 3) * 3;
    rows.set(y, [...(rows.get(y) || []), { x, text }]);
  }
  return [...rows.entries()]
    .sort(([first], [second]) => second - first)
    .map(([, row]) =>
      row
        .sort((first, second) => first.x - second.x)
        .map((item) => item.text)
        .join(" "),
    )
    .join("\n");
}

function extractQualitativeFindings(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 2 && line.length < 180);
  return {
    negative: lines.filter((line) => /\bnegative\b/i.test(line)).slice(0, 8),
    positive: lines.filter((line) => /\bpositive\b/i.test(line)).slice(0, 8),
  };
}

function StructuredAiInsight({ text }: { text: string }) {
  const sections = text
    .split(/^##\s+/m)
    .map((section) => section.trim())
    .filter(Boolean);
  return (
    <div className="structured-ai-output">
      {sections.map((section, index) => {
        const [heading, ...body] = section.split("\n");
        return (
          <section key={`${heading}-${index}`}>
            <h4>{heading.replace(/\*\*/g, "")}</h4>
            <div>
              {body
                .filter((line) => line.trim())
                .map((line, lineIndex) => (
                  <p key={lineIndex}>
                    {/^[-*•]\s+/.test(line) && <i />}
                    {line.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "")}
                  </p>
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function OcrWorkspace({
  user,
  onRequireSignIn,
  onSendToDoctor,
  onFindDoctor,
}: {
  user: User | null;
  onRequireSignIn: () => void;
  onSendToDoctor?: (payload: { text: string; aiInsight: string; summary: string }) => void;
  onFindDoctor?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [text, setText] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(
    "Choose a clear JPG, PNG, or WebP medical report.",
  );
  const [working, setWorking] = useState(false);
  const [aiWorking, setAiWorking] = useState(false);
  const [aiInsight, setAiInsight] = useState("");
  const [aiError, setAiError] = useState("");
  const [lastScanKey, setLastScanKey] = useState("");
  const [error, setError] = useState("");
  const analysis = useMemo(() => analyzeReport(text), [text]);
  const comparisons = useMemo(() => extractComparisons(text), [text]);
  const qualitative = useMemo(() => extractQualitativeFindings(text), [text]);
  const normalFindings = comparisons.filter((item) => item.status === "Normal");
  const attentionFindings = comparisons.filter(
    (item) => item.status !== "Normal",
  );
  const seriousFlag =
    analysis.severity === "High" ||
    attentionFindings.length >= 2 ||
    /emergency|critical|urgent|severe|chest pain|breathless|unconscious|very high|बहुत गंभीर|तुरंत/i.test(
      `${text}\n${aiInsight}`,
    );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError("");
    if (selected && selected.size > 15 * 1024 * 1024) {
      setFile(null);
      setStatus("File is too large.");
      setError("Choose a PDF or image smaller than 15 MB.");
      event.target.value = "";
      return;
    }
    const nextKey = selected
      ? `${selected.name}:${selected.size}:${selected.lastModified}`
      : "";
    setFile(selected);
    if (nextKey !== lastScanKey) {
      setText("");
      setAiInsight("");
      setProgress(0);
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(
      selected && selected.type !== "application/pdf"
        ? URL.createObjectURL(selected)
        : "",
    );
    setStatus(
      selected
        ? `${selected.name} is ready for local OCR.`
        : "Choose a report image.",
    );
  }

  async function prepareImage(source: Blob) {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not prepare this image.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray =
        pixels.data[index] * 0.299 +
        pixels.data[index + 1] * 0.587 +
        pixels.data[index + 2] * 0.114;
      const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
      pixels.data[index] = enhanced;
      pixels.data[index + 1] = enhanced;
      pixels.data[index + 2] = enhanced;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  async function runOcr() {
    if (!file) return;
    const scanKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (scanKey === lastScanKey && text) {
      setStatus("This file is already scanned. Use Scan again to repeat OCR.");
      return;
    }
    setWorking(true);
    setText("");
    setError("");
    setProgress(0);
    setStatus("Loading OCR engine...");
    let worker: Awaited<
      ReturnType<(typeof import("tesseract.js"))["createWorker"]>
    > | null = null;
    try {
      const Tesseract = await import("tesseract.js");
      const updateProgress = (message: {
        progress?: number;
        status?: string;
      }) => {
        if (message.progress !== undefined)
          setProgress(Math.round(message.progress * 100));
        if (message.status) setStatus(message.status);
      };
      let extractedForAnalysis = "";
      if (file.type === "application/pdf") {
        setStatus("Opening PDF...");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const document = await pdfjs.getDocument({
          data: await file.arrayBuffer(),
        }).promise;
        const pages: string[] = [];
        for (
          let pageNumber = 1;
          pageNumber <= document.numPages;
          pageNumber += 1
        ) {
          setStatus(`Checking PDF page ${pageNumber} of ${document.numPages}...`);
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          const embeddedText = cleanExtractedText(
            pdfItemsToReadableText(
              content.items.filter(
                (item): item is typeof item & { str: string } => "str" in item,
              ),
            ),
          );
          if (embeddedText.length >= 30) {
            pages.push(embeddedText);
            setProgress(Math.round((pageNumber / document.numPages) * 100));
            continue;
          }
          if (!worker)
            worker = await Tesseract.createWorker("eng", 1, {
              logger: updateProgress,
            });
          setStatus(
            `OCR scanning PDF page ${pageNumber} of ${document.numPages}...`,
          );
          const viewport = page.getViewport({ scale: 1.7 });
          const canvas = window.document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not render the PDF page.");
          await page.render({ canvas, canvasContext: context, viewport })
            .promise;
          const result = await worker.recognize(canvas);
          pages.push(result.data.text.trim());
        }
        const extracted = cleanExtractedText(
          pages.filter(Boolean).join("\n\n"),
        );
        if (!extracted)
          throw new Error(
            "No readable text was found. Try a clearer scan or image.",
          );
        setText(extracted);
        extractedForAnalysis = extracted;
      } else {
        worker = await Tesseract.createWorker("eng", 1, {
          logger: updateProgress,
        });
        const prepared = await prepareImage(file);
        const result = await worker.recognize(prepared);
        const extracted = cleanExtractedText(result.data.text);
        if (!extracted)
          throw new Error(
            "No readable text was found. Try brighter lighting and a straight image.",
          );
        setText(extracted);
        extractedForAnalysis = extracted;
      }
      setProgress(100);
      setStatus("OCR completed. Sending text to AI analysis...");
      setLastScanKey(scanKey);
      void generateAiInsight(extractedForAnalysis);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "OCR failed. Try a clearer image.";
      setError(message);
      setStatus("OCR could not complete.");
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      setWorking(false);
    }
  }

  function downloadText() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${file?.name.replace(/\.[^.]+$/, "") || "medical-report"}-ocr.txt`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  async function downloadPdf() {
    if (!text) return;
    if (!user) return onRequireSignIn();
    const readings: ReportReading[] = comparisons.length
      ? comparisons.map((item) => ({
          label: item.name,
          value: `${item.value} ${item.unit}`,
          reference: `${item.range} ${item.unit}`,
          status: item.status as ReportReading["status"],
        }))
      : [
          {
            label: "OCR values",
            value: "No supported values detected",
            reference: "Use original laboratory range",
            status: "Unavailable",
          },
        ];
    const aiText =
      aiInsight ||
      [
        "## English Summary",
        analysis.summary,
        "## English Findings",
        `Screening severity: ${analysis.severity}. Keywords: ${analysis.keywords.join(", ") || "None detected"}.`,
        "## English Suggestions",
        analysis.recommendation,
        "## हिंदी सारांश",
        "OCR से निकाली गई रिपोर्ट को मूल रिपोर्ट से सत्यापित करें।",
        "## हिंदी सुझाव",
        "असामान्य या चिंताजनक परिणामों पर योग्य डॉक्टर से सलाह लें।",
        "## When to consult a doctor / डॉक्टर से कब मिलें",
        "Verify OCR values against the original report and discuss concerning results with a qualified clinician.",
      ].join("\n");
    const database = getRealtimeDatabase();
    const profile = database
      ? await get(ref(database, `users/${user.uid}/profile`))
          .then((snapshot) => snapshot.val() || {})
          .catch(() => ({}))
      : {};
    await downloadHealthReport({
      filename: `${file?.name.replace(/\.[^.]+$/, "") || "medical-report"}-analysis.pdf`,
      title: "Medical Report Analysis",
      subtitle:
        "OCR-extracted medical values with reference comparisons and AI-assisted educational guidance.",
      metadata: [
        [
          "Patient",
          profile.fullName || user.displayName || "Authenticated member",
        ],
        ["Blood group", profile.bloodGroup || "Not supplied"],
        ["Known allergies", profile.allergies || "Not supplied"],
        ["Emergency contact", profile.emergencyPhone || "Not supplied"],
        ["Source file", file?.name || "Medical report"],
        ["Screening severity", analysis.severity],
      ],
      readings,
      aiText,
      disclaimer:
        "OCR can misread medical values. Reference intervals vary by laboratory, age, sex, pregnancy, medicines, and clinical context. Verify the original report with a qualified clinician.",
      profile: {
        name: user.displayName || user.phoneNumber || "Sanjeevni-AI member",
        photoURL: user.photoURL,
      },
    });
  }

  function readReportAloud() {
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window))
      return;
    window.speechSynthesis.cancel();
    const readable = [
      "Medical report educational summary.",
      analysis.summary,
      comparisons.length
        ? `Detected ${comparisons.length} measurable values. ${attentionFindings.length} need attention.`
        : "No supported numeric values were detected.",
      aiInsight.replace(/[#*_`>-]/g, " ").slice(0, 2200),
    ]
      .filter(Boolean)
      .join(" ");
    const utterance = new SpeechSynthesisUtterance(readable);
    utterance.lang = /[\u0900-\u097F]/.test(readable) ? "hi-IN" : "en-IN";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  }

  async function generateAiInsight(sourceText = text) {
    if (!sourceText || aiWorking) return;
    setAiWorking(true);
    setAiError("");
    try {
      const sourceComparisons = extractComparisons(sourceText);
      const comparisonText = sourceComparisons
        .map(
          (item) =>
            `${item.name}: ${item.value} ${item.unit}; reference ${item.range} ${item.unit}; status ${item.status}`,
        )
        .join("\n");
      const response = await fetch(`${apiBaseUrl}/api/v1/doctor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: [
            "Analyze this OCR medical report for educational use.",
            "Return a concise bilingual report in both English and natural Hindi.",
            "Use exactly these Markdown headings:",
            "## English Summary",
            "## English Findings",
            "## English Suggestions",
            "## हिंदी सारांश",
            "## हिंदी महत्वपूर्ण निष्कर्ष",
            "## हिंदी सुझाव",
            "## When to consult a doctor / डॉक्टर से कब मिलें",
            "Clearly separate values within reference from values needing attention.",
            "Do not interpret the word positive as automatically good; explain it in test context.",
            "Do not diagnose or prescribe medicine. Mention OCR uncertainty and missing values.",
            comparisonText ? `Detected comparisons:\n${comparisonText}` : "",
            `OCR text:\n${sourceText.slice(0, 8000)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "AI analysis is unavailable.");
      setAiInsight(data.answer);
      setStatus("OCR and bilingual AI analysis completed.");
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "AI analysis could not be generated.",
      );
      setStatus("OCR completed, but AI analysis could not finish.");
    } finally {
      setAiWorking(false);
    }
  }

  const pipelineProgress = aiInsight
    ? 100
    : aiWorking
      ? 88
      : text
        ? 75
        : working
          ? Math.min(70, 20 + Math.round(progress * 0.5))
          : file
            ? 20
            : 0;

  return (
    <section id="ocr" className="ocr-workspace">
      <div className="ocr-hero">
        <div>
          <span className="kicker">
            <ScanText size={14} /> Private report intelligence
          </span>
          <h2>Scan, verify, and understand your medical report.</h2>
          <p>
            Extract text locally, correct OCR mistakes, compare supported
            readings, and generate a structured educational summary.
          </p>
        </div>
        <div className="privacy-pill">
          <ShieldCheck size={16} /> No server upload
        </div>
      </div>
      <div className="ocr-pipeline">
        <div className="pipeline-top">
          <strong>Report processing pipeline</strong>
          <span>{pipelineProgress}% complete</span>
        </div>
        <div className="pipeline-track">
          <span style={{ width: `${pipelineProgress}%` }} />
        </div>
        <div className="ocr-steps">
          <div className={file ? "complete" : "active"}>
            <b>{file ? <CheckCircle2 size={15} /> : "1"}</b>
            <p><strong>File selected</strong><small>{file ? "Upload ready" : "Waiting for report"}</small></p>
          </div>
          <i className={pipelineProgress >= 25 ? "flowing" : ""}><span /></i>
          <div className={text ? "complete" : working ? "active" : ""}>
            <b>{text ? <CheckCircle2 size={15} /> : "2"}</b>
            <p><strong>OCR extraction</strong><small>{working ? `${progress}% · ${status}` : text ? "Text extracted" : "Not started"}</small></p>
          </div>
          <i className={pipelineProgress >= 70 ? "flowing" : ""}><span /></i>
          <div className={text ? "complete" : ""}>
            <b>{text ? <CheckCircle2 size={15} /> : "3"}</b>
            <p><strong>Review text</strong><small>{text ? `${text.length.toLocaleString()} characters ready` : "Awaiting OCR"}</small></p>
          </div>
          <i className={pipelineProgress >= 80 ? "flowing" : ""}><span /></i>
          <div className={aiInsight ? "complete" : aiWorking ? "active" : ""}>
            <b>{aiInsight ? <CheckCircle2 size={15} /> : "4"}</b>
            <p><strong>AI analysis</strong><small>{aiWorking ? "Generating insight..." : aiInsight ? "Analysis complete" : "Optional final step"}</small></p>
          </div>
        </div>
      </div>

      <div className="ocr-main-grid">
        <div className="upload-card surface">
          <label className="upload-zone">
            <input
              className="sr-only"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={chooseFile}
            />
            {/* Blob previews are local-only and cannot use the Next.js image optimizer. */}
            {preview ? (
              <img src={preview} alt="Selected medical report preview" />
            ) : (
              <FileImage size={38} />
            )}
            <strong>{file ? file.name : "Select report image"}</strong>
            <span>PDF, PNG, JPG, JPEG, or WebP · Maximum 15 MB</span>
            {file && (
              <em>
                <FileCheck2 size={14} />
                {(file.size / 1024 / 1024).toFixed(2)} MB · Ready
              </em>
            )}
          </label>
          <button
            className="primary-button w-full"
            disabled={
              !file ||
              working ||
              Boolean(
                text &&
                  file &&
                  `${file.name}:${file.size}:${file.lastModified}` ===
                    lastScanKey,
              )
            }
            onClick={runOcr}
          >
            {working ? (
              <LoaderCircle className="animate-spin" size={18} />
            ) : (
              <ScanText size={18} />
            )}
            {working
              ? `Reading report ${progress}%`
              : text
                ? "Scan completed"
                : "Extract report text"}
          </button>
          {text && (
            <button
              className="rescan-button"
              disabled={working}
              onClick={() => {
                setLastScanKey("");
                setText("");
                setAiInsight("");
                setProgress(0);
                setStatus("Ready to scan this file again.");
              }}
            >
              <RefreshCcw size={15} /> Scan again
            </button>
          )}
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="status-line">
            {working ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}{" "}
            {status}
          </p>
          {error && (
            <div className="ocr-error">
              <AlertTriangle size={16} />
              <span>{error}</span>
              <button onClick={runOcr} disabled={!file || working}>
                Retry
              </button>
            </div>
          )}
        </div>

        <div className="ocr-result surface">
          <div className="result-toolbar">
            <div>
              <span>Extracted text</span>
              <small>{text.length.toLocaleString()} characters</small>
            </div>
            <div className="flex gap-2">
              <button
                className="icon-button"
                disabled={!text}
                onClick={() => navigator.clipboard.writeText(text)}
                aria-label="Copy OCR text"
              >
                <Copy size={17} />
              </button>
              <button
                className="icon-button"
                disabled={!text}
                onClick={downloadText}
                aria-label="Download OCR text"
              >
                <Download size={17} />
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Extracted medical report text will appear here..."
          />
          <p className="medical-note">
            OCR output can contain mistakes. A qualified clinician must verify
            medical information.
          </p>
        </div>
      </div>
      {text && (
        <div className="report-analysis-grid">
          <article className="comparison-card">
            <div className="comparison-heading">
              <div>
                <small>Your values vs reference</small>
                <p>
                  Automatically detected values are compared with general adult
                  screening references.
                </p>
              </div>
              <span>{comparisons.length} detected</span>
            </div>
            {comparisons.length ? (
              <div className="comparison-table">
                <div className="comparison-row header">
                  <span>Test</span>
                  <span>Your value</span>
                  <span>Reference</span>
                  <span>Status</span>
                </div>
                {comparisons.map((item) => (
                  <div className="comparison-row" key={item.name}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.value} {item.unit}
                    </span>
                    <span>
                      {item.range} {item.unit}
                    </span>
                    <b className={item.status.toLowerCase()}>{item.status}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="comparison-empty">
                No supported numeric test values were found. OCR wording can
                vary; always use the reference interval printed on the original
                laboratory report.
              </p>
            )}
            <p className="reference-note">
              Reference intervals can differ by laboratory, age, sex, pregnancy,
              medicines, and clinical context. The original lab’s interval takes
              priority.
            </p>
          </article>
          <article className="finding-groups">
            <div className="finding-column normal">
              <div className="finding-title">
                <CheckCircle2 size={17} />
                <span>
                  <strong>Within reference / सामान्य</strong>
                  <small>{normalFindings.length + qualitative.negative.length} findings</small>
                </span>
              </div>
              {normalFindings.map((item) => (
                <p key={item.name}>
                  <b>{item.name}</b>
                  <span>{item.value} {item.unit}</span>
                </p>
              ))}
              {qualitative.negative.map((line) => (
                <p key={line}><b>Reported negative</b><span>{line}</span></p>
              ))}
              {!normalFindings.length && !qualitative.negative.length && (
                <em>No clearly normal or reported-negative finding detected.</em>
              )}
            </div>
            <div className="finding-column attention">
              <div className="finding-title">
                <AlertTriangle size={17} />
                <span>
                  <strong>Needs attention / ध्यान दें</strong>
                  <small>{attentionFindings.length + qualitative.positive.length} findings</small>
                </span>
              </div>
              {attentionFindings.map((item) => (
                <p key={item.name}>
                  <b>{item.name} · {item.status}</b>
                  <span>{item.value} {item.unit}</span>
                </p>
              ))}
              {qualitative.positive.map((line) => (
                <p key={line}><b>Reported positive</b><span>{line}</span></p>
              ))}
              {!attentionFindings.length && !qualitative.positive.length && (
                <em>No supported value requiring attention was detected.</em>
              )}
            </div>
            <small className="finding-disclaimer">
              “Positive” and “negative” are reported test words—not good/bad
              labels. Confirm their meaning from the original report and clinician.
            </small>
          </article>
          <article>
            <span className="analysis-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <small>AI report summary</small>
              <p>{analysis.summary}</p>
            </div>
          </article>
          <article>
            <span className={`severity ${analysis.severity.toLowerCase()}`}>
              <AlertTriangle size={17} />
              {analysis.severity}
            </span>
            <div>
              <small>Screening severity</small>
              <p>{analysis.recommendation}</p>
            </div>
          </article>
          <article className="keyword-card">
            <div>
              <small>Medical keywords</small>
              <div>
                {analysis.keywords.length ? (
                  analysis.keywords.map((term) => (
                    <span key={term}>{term}</span>
                  ))
                ) : (
                  <span>None detected</span>
                )}
              </div>
            </div>
            <button className="primary-button" onClick={downloadPdf}>
              <Download size={17} /> Download analysis PDF
            </button>
          </article>
          <article className="ai-report-card">
            <span className="analysis-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <small>AI Doctor report intelligence</small>
              <div className="ai-report-actions">
                <button disabled={!text} onClick={readReportAloud}>
                  <Volume2 size={15} /> Read report
                </button>
                <button
                  disabled={!text}
                  onClick={() =>
                    onSendToDoctor?.({
                      text,
                      aiInsight,
                      summary: analysis.summary,
                    })
                  }
                >
                  <MessageCircleHeart size={15} /> Ask AI Doctor
                </button>
                <button onClick={onFindDoctor}>
                  <Stethoscope size={15} /> Professional doctor
                </button>
              </div>
              {seriousFlag && (
                <div className="serious-care-card">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Serious condition check</strong>
                    <p>
                      Some values or words may need clinician review. If there
                      is chest pain, breathing trouble, fainting, confusion, or
                      rapidly worsening symptoms, contact emergency care now.
                    </p>
                  </div>
                  <button onClick={onFindDoctor}>Find doctor</button>
                </div>
              )}
              {aiInsight ? (
                <StructuredAiInsight text={aiInsight} />
              ) : (
                <p>
                  {aiWorking
                    ? "OCR text has reached the AI pipeline. Generating English and Hindi analysis..."
                    : aiError || "Waiting for extracted text..."}
                </p>
              )}
            </div>
            <button
              className="primary-button"
              disabled={aiWorking}
              onClick={() => generateAiInsight()}
            >
              {aiWorking ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              {aiWorking
                ? "Analyzing..."
                : aiInsight
                  ? "Regenerate bilingual analysis"
                  : "Retry AI analysis"}
            </button>
          </article>
        </div>
      )}
    </section>
  );
}
