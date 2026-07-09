"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  get,
  limitToLast,
  onChildAdded,
  push,
  query,
  ref,
  set,
} from "firebase/database";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BrainCircuit,
  ChevronRight,
  CloudOff,
  Database,
  Dna,
  Droplets,
  FileClock,
  FileSearch,
  Gauge,
  HeartPulse,
  History,
  Languages,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageCircleHeart,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Sun,
  Thermometer,
  Wifi,
  Zap,
  Download,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Video,
  X,
  Copy,
  RotateCcw,
  Bookmark,
  Check,
  ClipboardPlus,
  BadgeCheck,
  CalendarDays,
  Clock,
  IndianRupee,
  LocateFixed,
  Mail,
  MapPin,
  Mic,
  MicOff,
  Star,
  Trash2,
  Volume2,
} from "lucide-react";
import { OcrWorkspace } from "@/components/ocr-workspace";
import { ProfilePanel } from "@/components/profile-panel";
import {
  firebaseConfigured,
  getFirebaseAuth,
  getRealtimeDatabase,
} from "@/lib/firebase";
import {
  assessVitals,
  demoPayload,
  latestPayload,
  normalizeVitals,
  SensorPayload,
} from "@/lib/vitals";
import { downloadHealthReport, ReportReading } from "@/lib/pdf-report";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:5100"
).replace(/\/+$/, "");
const firebasePath =
  process.env.NEXT_PUBLIC_IOT_FIREBASE_PATH ||
  "devices/ai-power-structural-health-m-s/readings";

type Page =
  | "Dashboard"
  | "Disease Prediction"
  | "Live IoT Monitoring"
  | "Medical Report Analysis"
  | "AI Doctor"
  | "Verified Doctors"
  | "History"
  | "Analytics"
  | "Settings"
  | "About";
type ModelStatus = {
  ready: boolean;
  enabled: boolean;
  reason?: string | null;
  features: string[];
};
type PredictionResult = {
  disease: string;
  prediction: number | string;
  confidence: number | null;
  generated_at: string;
};
type VitalsPoint = ReturnType<typeof normalizeVitals> & { receivedAt: number };
type ChatAttachment = {
  name: string;
  type: string;
  size: number;
  status: "processing" | "ready" | "error";
  context: string;
  preview?: string;
};
type DoctorChatMessage = { role: "user" | "assistant"; text: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type DiagnosticForm = {
  name: string;
  age: string;
  gender: string;
  bloodGroup: string;
  weight: string;
  height: string;
  testType: string;
  notes: string;
  consent: boolean;
};

const navItems: { name: Page; icon: typeof Activity }[] = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Disease Prediction", icon: Dna },
  { name: "Live IoT Monitoring", icon: Activity },
  { name: "Medical Report Analysis", icon: FileSearch },
  { name: "AI Doctor", icon: MessageCircleHeart },
  { name: "Verified Doctors", icon: Stethoscope },
  { name: "History", icon: History },
  { name: "Analytics", icon: BarChart3 },
];

const hindiPages: Record<Page, string> = {
  Dashboard: "डैशबोर्ड",
  "Disease Prediction": "रोग जोखिम जांच",
  "Live IoT Monitoring": "लाइव IoT निगरानी",
  "Medical Report Analysis": "मेडिकल रिपोर्ट विश्लेषण",
  "AI Doctor": "AI डॉक्टर",
  "Verified Doctors": "सत्यापित डॉक्टर",
  History: "इतिहास",
  Analytics: "विश्लेषण",
  Settings: "सेटिंग्स",
  About: "ऐप के बारे में",
};

const chartPaths = [
  "M0 32 C12 24 18 37 30 26 S48 18 58 29 S78 36 88 18 S105 24 120 12",
  "M0 28 C10 34 20 18 32 26 S52 32 64 15 S85 26 96 18 S110 24 120 8",
  "M0 25 C14 16 22 38 36 24 S57 15 70 28 S90 35 101 17 S113 20 120 12",
];

function Sparkline({ index = 0 }: { index?: number }) {
  return (
    <svg className="sparkline" viewBox="0 0 120 44" preserveAspectRatio="none">
      <path d={chartPaths[index % chartPaths.length]} />
    </svg>
  );
}

function formatField(value: string) {
  return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export default function Home() {
  const [activePage, setActivePage] = useState<Page>("Dashboard");
  const [user, setUser] = useState<User | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [payload, setPayload] = useState<SensorPayload>(demoPayload);
  const [connection, setConnection] = useState<
    "connecting" | "live" | "demo" | "error"
  >(firebaseConfigured ? "connecting" : "demo");
  const [dataStale, setDataStale] = useState(true);
  const [models, setModels] = useState<Record<string, ModelStatus>>({});
  const [selectedDisease, setSelectedDisease] = useState("heart");
  const [values, setValues] = useState<Record<string, string>>({});
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [predictionError, setPredictionError] = useState("");
  const [vitalsHistory, setVitalsHistory] = useState<VitalsPoint[]>([]);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [chat, setChat] = useState<DoctorChatMessage[]>([
    {
      role: "assistant",
      text: "Hello, I’m your AI health assistant. I can help explain vitals, reports, and screening results in clear language.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [doctorWorking, setDoctorWorking] = useState(false);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveVoiceRef = useRef(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [liveVoiceMode, setLiveVoiceMode] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [doctorMenuOpen, setDoctorMenuOpen] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null);
  const [importantMessages, setImportantMessages] = useState<Set<number>>(
    new Set(),
  );
  const [iotReportWorking, setIotReportWorking] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [diagnosticForm, setDiagnosticForm] = useState<DiagnosticForm>({
    name: "",
    age: "",
    gender: "",
    bloodGroup: "",
    weight: "",
    height: "",
    testType: "Complete vitals",
    notes: "",
    consent: false,
  });
  const [diagnosticRequest, setDiagnosticRequest] = useState<{
    id: string;
    status: string;
  } | null>(null);
  const [diagnosticResult, setDiagnosticResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [diagnosticAi, setDiagnosticAi] = useState("");
  const [diagnosticError, setDiagnosticError] = useState("");
  const [diagnosticSubmitting, setDiagnosticSubmitting] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: "Sensor stream is stale",
      detail: "No fresh hardware reading received in the last 30 seconds.",
      time: "Now",
      unread: true,
      tone: "warning",
    },
    {
      id: 2,
      title: "AI Doctor connected",
      detail: "NVIDIA provider is ready for health guidance.",
      time: "5 min",
      unread: true,
      tone: "success",
    },
    {
      id: 3,
      title: "Report tools ready",
      detail: "OCR and IoT diagnostic PDF reports are available.",
      time: "Today",
      unread: true,
      tone: "info",
    },
  ]);
  const vitals = useMemo(() => normalizeVitals(payload), [payload]);
  const alerts = useMemo(() => assessVitals(vitals), [vitals]);
  const selectedModel = models[selectedDisease];

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    try {
      const savedPage = sessionStorage.getItem("sanjeevni-ai.activePage") as Page | null;
      const savedChat = sessionStorage.getItem("sanjeevni-ai.aiDoctor.chat");
      const savedTheme = sessionStorage.getItem("sanjeevni-ai.theme");
      const savedLanguage = sessionStorage.getItem("sanjeevni-ai.language") as
        | "en"
        | "hi"
        | null;
      if (savedPage) setActivePage(savedPage);
      if (savedChat) {
        const parsed = JSON.parse(savedChat) as DoctorChatMessage[];
        if (Array.isArray(parsed) && parsed.length) setChat(parsed.slice(-30));
      }
      if (savedTheme) setDark(savedTheme === "dark");
      if (savedLanguage === "en" || savedLanguage === "hi")
        setLanguage(savedLanguage);
    } catch {
      // Session restore is best-effort only.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("sanjeevni-ai.activePage", activePage);
      sessionStorage.setItem("sanjeevni-ai.theme", dark ? "dark" : "light");
      sessionStorage.setItem("sanjeevni-ai.language", language);
      sessionStorage.setItem(
        "sanjeevni-ai.aiDoctor.chat",
        JSON.stringify(chat.slice(-30)),
      );
    } catch {
      // Private browsing or storage restrictions should not break the app.
    }
  }, [activePage, chat, dark, language]);

  useEffect(() => {
    document.documentElement.lang = language === "hi" ? "hi" : "en";
    const auth = getFirebaseAuth();
    return auth ? onAuthStateChanged(auth, setUser) : undefined;
  }, [language]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/v1/models`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        setModels(data);
        const firstReady = Object.keys(data).find((key) => data[key].ready);
        if (firstReady) setSelectedDisease(firstReady);
      })
      .catch(() => setModels({}));
  }, []);

  useEffect(() => {
    const database = getRealtimeDatabase();
    if (!database) return;
    const latestReadings = query(ref(database, firebasePath), limitToLast(60));
    return onChildAdded(
      latestReadings,
      (snapshot) => {
        const nextPayload = latestPayload(snapshot.val());
        const receivedAt = Date.now();
        setPayload(nextPayload);
        setLastReceivedAt(receivedAt);
        setVitalsHistory((current) =>
          [...current, { ...normalizeVitals(nextPayload), receivedAt }].slice(
            -60,
          ),
        );
        setConnection("live");
        const hardwareTime = normalizeVitals(nextPayload).timestamp;
        const timestamp = hardwareTime ? new Date(hardwareTime).getTime() : NaN;
        setDataStale(
          !Number.isFinite(timestamp) || Date.now() - timestamp > 30_000,
        );
      },
      () => setConnection("error"),
    );
  }, []);

  useEffect(() => {
    if (!lastReceivedAt) return;
    const timer = window.setInterval(() => {
      const timestamp = vitals.timestamp
        ? new Date(vitals.timestamp).getTime()
        : NaN;
      setDataStale(
        !Number.isFinite(timestamp) ||
          Date.now() - timestamp > 30_000 ||
          Date.now() - lastReceivedAt > 30_000,
      );
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [lastReceivedAt, vitals.timestamp]);

  useEffect(() => {
    if (!notificationOpen) return;
    function closeNotifications(event: MouseEvent) {
      const menu = document.querySelector(".notification-wrap");
      if (menu && !menu.contains(event.target as Node))
        setNotificationOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setNotificationOpen(false);
    }
    document.addEventListener("mousedown", closeNotifications);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeNotifications);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationOpen]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
    },
    [],
  );

  useEffect(() => {
    if (!diagnosticRequest || diagnosticRequest.status === "completed") return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/diagnostics/${diagnosticRequest.id}`,
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Could not read diagnostic status.");
        setDiagnosticRequest({ id: diagnosticRequest.id, status: data.status });
        if (data.status === "completed" && data.result) {
          setDiagnosticResult(data.result);
          const resultPayload = latestPayload(data.result);
          setPayload(resultPayload);
          window.clearInterval(poll);
          await analyzeDiagnosticResult(data.result);
        }
      } catch (error) {
        setDiagnosticError(
          error instanceof Error
            ? error.message
            : "Diagnostic status check failed.",
        );
      }
    }, 2000);
    return () => window.clearInterval(poll);
    // Polling is intentionally keyed only by the active request identity/status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticRequest?.id, diagnosticRequest?.status]);

  function navigate(page: Page) {
    setActivePage(page);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runPrediction(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedModel?.ready) return;
    setPredicting(true);
    setPrediction(null);
    setPredictionError("");
    try {
      const features = Object.fromEntries(
        selectedModel.features.map((field) => [field, Number(values[field])]),
      );
      const response = await fetch(
        `${apiBaseUrl}/api/v1/predict/${selectedDisease}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ features }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prediction unavailable");
      setPrediction(data);
    } catch (error) {
      setPredictionError(
        error instanceof Error
          ? error.message
          : "Could not reach the prediction service.",
      );
    } finally {
      setPredicting(false);
    }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (
      (!chatInput.trim() && !attachment) ||
      doctorWorking ||
      attachment?.status === "processing"
    )
      return;
    const question = chatInput.trim() || "Please explain the attached file.";
    const attachmentContext = attachment?.context
      ? `\n\nAttached file: ${attachment.name} (${attachment.type}).\nExtracted local content:\n${attachment.context.slice(0, 7000)}`
      : "";
    const userMessage: DoctorChatMessage = {
      role: "user",
      text: `${question}${attachment ? `\n📎 ${attachment.name}` : ""}`,
    };
    const nextHistory = [...chat, userMessage];
    setChat(nextHistory);
    setChatInput("");
    setAttachment(null);
    setDoctorWorking(true);
    await requestDoctorResponse(question, attachmentContext, nextHistory);
  }

  async function requestDoctorResponse(
    question: string,
    attachmentContext = "",
    historySnapshot: DoctorChatMessage[] = chat,
  ) {
    setDoctorWorking(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/doctor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `${question}${attachmentContext}`,
          history: historySnapshot
            .slice(-8)
            .map((item) => ({ role: item.role, content: item.text })),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "AI Doctor is unavailable.");
      const answer = data.answer;
      setChat((current) => [
        ...current,
        { role: "assistant", text: answer },
      ]);
      if (liveVoiceRef.current) speakDoctorAnswer(answer);
    } catch (error) {
      setChat((current) => [
        ...current,
        {
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "AI Doctor could not respond. Please try again.",
        },
      ]);
    } finally {
      setDoctorWorking(false);
    }
  }

  async function copyDoctorMessage(text: string, index: number) {
    await navigator.clipboard.writeText(text);
    setCopiedMessage(index);
    window.setTimeout(() => setCopiedMessage(null), 1600);
  }

  function askAgain(index: number) {
    const previousQuestion = [...chat.slice(0, index)]
      .reverse()
      .find((item) => item.role === "user");
    if (!previousQuestion || doctorWorking) return;
    const question = previousQuestion.text.replace(/\n📎.*$/, "").trim();
    setChat((current) => [
      ...current,
      { role: "user", text: `${question}\n↻ Asked again` },
    ]);
    requestDoctorResponse(question, "", [
      ...chat,
      { role: "user", text: `${question}\n↻ Asked again` },
    ]);
  }

  function toggleImportant(index: number) {
    setImportantMessages((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function getSpeechRecognitionConstructor() {
    return typeof window !== "undefined"
      ? ((window as unknown as {
          SpeechRecognition?: new () => SpeechRecognitionLike;
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }).SpeechRecognition ??
          (window as unknown as {
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).webkitSpeechRecognition)
      : undefined;
  }

  function speakDoctorAnswer(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceNotice("Your browser can show the answer, but cannot read it aloud.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      text.replace(/[#*_`>-]/g, " ").slice(0, 2800),
    );
    utterance.lang = language === "hi" ? "hi-IN" : "en-IN";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoiceInput() {
    setVoiceNotice("");
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) {
      setVoiceNotice(
        "Voice input is supported mainly in Chrome/Edge on localhost or HTTPS. Please type for now.",
      );
      setChatInput((current) =>
        current
          ? current
          : "Voice input is not supported in this browser. Please type your question.",
      );
      return;
    }
    if (voiceListening) {
      recognitionRef.current?.stop();
      setVoiceListening(false);
      return;
    }
    const recognition = new SpeechRecognitionConstructor();
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (spoken) setChatInput(spoken);
    };
    recognition.onend = () => setVoiceListening(false);
    recognition.onerror = () => {
      setVoiceListening(false);
      setVoiceNotice(
        "Voice capture stopped. Please allow microphone permission and try again in Chrome/Edge.",
      );
    };
    recognitionRef.current = recognition;
    setVoiceListening(true);
    try {
      recognition.start();
    } catch {
      setVoiceListening(false);
      setVoiceNotice("Voice capture could not start. Please retry once.");
    }
  }

  function toggleLiveVoiceChat() {
    setVoiceNotice("");
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) {
      setVoiceNotice(
        "Live voice chat needs Chrome/Edge speech recognition on localhost or HTTPS.",
      );
      return;
    }
    if (liveVoiceMode || voiceListening) {
      liveVoiceRef.current = false;
      setLiveVoiceMode(false);
      setVoiceListening(false);
      recognitionRef.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
      return;
    }
    const recognition = new SpeechRecognitionConstructor();
    liveVoiceRef.current = true;
    setLiveVoiceMode(true);
    setVoiceListening(true);
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const finalText = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (!finalText || doctorWorking) return;
      const userMessage: DoctorChatMessage = { role: "user", text: finalText };
      const nextHistory = [...chat, userMessage];
      setChat(nextHistory);
      requestDoctorResponse(finalText, "", nextHistory);
    };
    recognition.onend = () => {
      setVoiceListening(false);
      if (liveVoiceRef.current && !doctorWorking) {
        try {
          recognition.start();
          setVoiceListening(true);
        } catch {
          liveVoiceRef.current = false;
          setLiveVoiceMode(false);
        }
      }
    };
    recognition.onerror = () => {
      liveVoiceRef.current = false;
      setLiveVoiceMode(false);
      setVoiceListening(false);
      setVoiceNotice(
        "Live voice stopped. Check microphone permission, then start again.",
      );
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      liveVoiceRef.current = false;
      setLiveVoiceMode(false);
      setVoiceListening(false);
      setVoiceNotice("Live voice could not start. Please retry once.");
    }
  }

  function clearDoctorChat() {
    const fresh: DoctorChatMessage[] = [
      {
        role: "assistant",
        text: "New session started. Tell me what you want to understand about your health data.",
      },
    ];
    setChat(fresh);
    setImportantMessages(new Set());
    setDoctorMenuOpen(false);
  }

  function exportDoctorChat() {
    const blob = new Blob(
      [
        chat
          .map((message) => `${message.role.toUpperCase()}\n${message.text}`)
          .join("\n\n---\n\n"),
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "ai-doctor-chat-history.txt";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    setDoctorMenuOpen(false);
  }

  function addLiveVitalsToChat() {
    const liveContext = [
      "Please explain my latest live vitals in simple language.",
      `Heart rate: ${vitals.heartRate ?? "not received"} bpm`,
      `SpO2: ${vitals.spo2 ?? "not received"}%`,
      `Temperature: ${vitals.temperature ?? "not received"} °C`,
      `Blood pressure: ${vitals.systolic ?? "not received"}/${vitals.diastolic ?? "not received"} mmHg`,
      `Glucose: ${vitals.glucose ?? "not received"} mg/dL`,
      `Data age: ${formatDataAge(vitals.timestamp)}`,
    ].join("\n");
    setChatInput(liveContext);
  }

  function sendOcrToDoctor(payload: {
    text: string;
    aiInsight: string;
    summary: string;
  }) {
    navigate("AI Doctor");
    setChatInput(
      [
        "Please review this OCR medical report and explain what needs attention.",
        `Current OCR summary: ${payload.summary}`,
        payload.aiInsight ? `Existing AI report:\n${payload.aiInsight}` : "",
        `OCR text:\n${payload.text.slice(0, 7000)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  async function chooseChatAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setAttachment({
        name: file.name,
        type: file.type || "file",
        size: file.size,
        status: "error",
        context: "File exceeds the 25 MB local processing limit.",
      });
      return;
    }
    const preview =
      file.type.startsWith("image/") || file.type.startsWith("video/")
        ? URL.createObjectURL(file)
        : undefined;
    setAttachment({
      name: file.name,
      type: file.type || "file",
      size: file.size,
      status: "processing",
      context: "",
      preview,
    });
    try {
      let context = "";
      if (file.type.startsWith("image/")) {
        const Tesseract = await import("tesseract.js");
        const result = await Tesseract.recognize(file, "eng");
        context =
          result.data.text.trim() ||
          "No readable text was detected in this image.";
      } else if (file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const document = await pdfjs.getDocument({
          data: await file.arrayBuffer(),
        }).promise;
        const pages: string[] = [];
        const Tesseract = await import("tesseract.js");
        for (
          let pageNumber = 1;
          pageNumber <= Math.min(document.numPages, 6);
          pageNumber += 1
        ) {
          const page = await document.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const embeddedText = textContent.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .trim();
          if (embeddedText) {
            pages.push(embeddedText);
            continue;
          }
          const viewport = page.getViewport({ scale: 1.4 });
          const canvas = window.document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const canvasContext = canvas.getContext("2d");
          if (!canvasContext) continue;
          await page.render({ canvas, canvasContext, viewport }).promise;
          const result = await Tesseract.recognize(canvas, "eng");
          pages.push(result.data.text.trim());
        }
        context =
          pages.join("\n\n").trim() ||
          "No readable text was detected in this PDF.";
      } else if (
        file.type.startsWith("text/") ||
        /\.(csv|json|md|txt)$/i.test(file.name)
      ) {
        context = (await file.text()).slice(0, 10000);
      } else if (file.type.startsWith("video/")) {
        context = `Video attached: ${file.name}, ${(file.size / 1024 / 1024).toFixed(2)} MB. GLM-5.2 cannot inspect video frames or audio; ask the user for a transcript or use a configured multimodal model.`;
      } else {
        context = `File attached: ${file.name}. This file format cannot be extracted locally.`;
      }
      setAttachment({
        name: file.name,
        type: file.type || "file",
        size: file.size,
        status: "ready",
        context,
        preview,
      });
    } catch (error) {
      setAttachment({
        name: file.name,
        type: file.type || "file",
        size: file.size,
        status: "error",
        context:
          error instanceof Error
            ? error.message
            : "Could not process this file.",
        preview,
      });
    }
  }

  async function downloadIoTReport() {
    if (iotReportWorking) return;
    if (!user) {
      setProfileOpen(true);
      return;
    }
    setIotReportWorking(true);
    const database = getRealtimeDatabase();
    const privateProfile = database
      ? await get(ref(database, `users/${user.uid}/profile`))
          .then((snapshot) => snapshot.val() || {})
          .catch(() => ({}))
      : {};
    const measuredAt = vitals.timestamp
      ? new Date(vitals.timestamp).toLocaleString("en-IN")
      : "Timestamp unavailable";
    const rows = [
      ["Heart rate", vitals.heartRate, "60–100 bpm"],
      ["SpO2", vitals.spo2, "95–100%"],
      ["Temperature", vitals.temperature, "36.1–37.2 °C"],
      ["Systolic BP", vitals.systolic, "< 120 mmHg"],
      ["Diastolic BP", vitals.diastolic, "< 80 mmHg"],
      ["Fasting glucose", vitals.glucose, "≤ 99 mg/dL"],
    ] as const;
    let aiReport =
      "AI Doctor analysis was unavailable. Review the numerical comparison below.";
    try {
      const values = rows
        .map(
          ([name, value, reference]) =>
            `${name}: ${value ?? "not received"}; general reference ${reference}`,
        )
        .join("\n");
      const response = await fetch(`${apiBaseUrl}/api/v1/doctor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: [
            "Create an educational live IoT health report from these latest sensor readings.",
            "Return concise sections: ## Summary, ## Important findings, ## Suggestions, ## Advice and when to seek care.",
            "Do not diagnose or prescribe. Clearly mention missing readings and device limitations.",
            values,
          ].join("\n\n"),
        }),
      });
      const data = await response.json();
      aiReport =
        response.ok && data.answer
          ? data.answer
          : `AI Doctor analysis unavailable: ${data.error || "unknown error"}`;
    } catch {
      aiReport =
        "AI Doctor could not be reached. The numerical comparison remains available below.";
    }
    const reportReadings: ReportReading[] = [
      {
        label: "Heart rate",
        value:
          vitals.heartRate === undefined
            ? "Not received"
            : `${vitals.heartRate} bpm`,
        reference: "60–100 bpm",
        status: rangeStatus(vitals.heartRate, 60, 100),
      },
      {
        label: "SpO₂",
        value: vitals.spo2 === undefined ? "Not received" : `${vitals.spo2}%`,
        reference: "95–100%",
        status: rangeStatus(vitals.spo2, 95, 100),
      },
      {
        label: "Temperature",
        value:
          vitals.temperature === undefined
            ? "Not received"
            : `${vitals.temperature} °C`,
        reference: "36.1–37.2 °C",
        status: rangeStatus(vitals.temperature, 36.1, 37.2),
      },
      {
        label: "Systolic BP",
        value:
          vitals.systolic === undefined
            ? "Not received"
            : `${vitals.systolic} mmHg`,
        reference: "< 120 mmHg",
        status: upperLimitStatus(vitals.systolic, 119),
      },
      {
        label: "Diastolic BP",
        value:
          vitals.diastolic === undefined
            ? "Not received"
            : `${vitals.diastolic} mmHg`,
        reference: "< 80 mmHg",
        status: upperLimitStatus(vitals.diastolic, 79),
      },
      {
        label: "Fasting glucose",
        value:
          vitals.glucose === undefined
            ? "Not received"
            : `${vitals.glucose} mg/dL`,
        reference: "≤ 99 mg/dL",
        status: upperLimitStatus(vitals.glucose, 99),
      },
    ];
    try {
      await downloadHealthReport({
        filename: `sanjeevni-ai-iot-report-${new Date().toISOString().slice(0, 10)}.pdf`,
        title: "Live IoT Health Report",
        subtitle:
          "Latest connected-device readings with general adult references and AI-assisted educational guidance.",
        metadata: [
          [
            "Patient",
            privateProfile.fullName ||
              user.displayName ||
              vitals.patientId ||
              "Authenticated member",
          ],
          ["Blood group", privateProfile.bloodGroup || "Not supplied"],
          ["Known allergies", privateProfile.allergies || "Not supplied"],
          [
            "Emergency contact",
            privateProfile.emergencyPhone || "Not supplied",
          ],
          ["Device", vitals.deviceId || "Biomedical monitor"],
          ["Sensor timestamp", measuredAt],
        ],
        readings: reportReadings,
        aiText: aiReport,
        disclaimer:
          "Reference values are general educational guides. Device calibration, measurement conditions, age, health history, and clinician-specific targets take priority. This report is not a diagnosis.",
        profile: {
          name: user.displayName || user.phoneNumber || "Sanjeevni-AI member",
          photoURL: user.photoURL,
        },
      });
    } finally {
      setIotReportWorking(false);
    }
  }

  async function submitDiagnosticRequest(event: React.FormEvent) {
    event.preventDefault();
    setDiagnosticSubmitting(true);
    setDiagnosticError("");
    setDiagnosticResult(null);
    setDiagnosticAi("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/diagnostics/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: diagnosticForm.name,
          age: diagnosticForm.age,
          gender: diagnosticForm.gender,
          blood_group: diagnosticForm.bloodGroup,
          weight_kg: diagnosticForm.weight,
          height_cm: diagnosticForm.height,
          test_type: diagnosticForm.testType,
          notes: diagnosticForm.notes,
          consent: diagnosticForm.consent,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not create diagnostic request.");
      setDiagnosticRequest({ id: data.request_id, status: data.status });
    } catch (error) {
      setDiagnosticError(
        error instanceof Error ? error.message : "Diagnostic request failed.",
      );
    } finally {
      setDiagnosticSubmitting(false);
    }
  }

  async function analyzeDiagnosticResult(result: Record<string, unknown>) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/doctor/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: [
            "Analyze this hardware diagnostic result for educational use.",
            "Return sections: ## Summary, ## Important findings, ## Suggestions, ## Advice and when to seek care.",
            "Compare values with general adult references, mention missing data, and do not diagnose or prescribe.",
            `Patient age: ${diagnosticForm.age}; gender: ${diagnosticForm.gender}; blood group: ${diagnosticForm.bloodGroup}; weight: ${diagnosticForm.weight} kg.`,
            `Hardware result: ${JSON.stringify(result).slice(0, 8000)}`,
          ].join("\n\n"),
        }),
      });
      const data = await response.json();
      setDiagnosticAi(
        response.ok ? data.answer : `AI analysis unavailable: ${data.error}`,
      );
    } catch {
      setDiagnosticAi(
        "AI analysis unavailable. Review the raw sensor values with a qualified clinician.",
      );
    }
  }

  async function downloadDiagnosticReport() {
    if (!diagnosticResult) return;
    if (!user) {
      setProfileOpen(true);
      return;
    }
    const resultVitals = normalizeVitals(latestPayload(diagnosticResult));
    await downloadHealthReport({
      filename: `diagnostic-${diagnosticRequest?.id || "report"}.pdf`,
      title: "Hardware Diagnostic Report",
      subtitle:
        "Patient diagnostic readings returned by the connected hardware and analyzed by Sanjeevni-AI Doctor.",
      metadata: [
        ["Patient", diagnosticForm.name],
        ["Age / Gender", `${diagnosticForm.age} / ${diagnosticForm.gender}`],
        ["Blood group", diagnosticForm.bloodGroup],
        [
          "Weight / Height",
          `${diagnosticForm.weight} kg / ${diagnosticForm.height || "Not supplied"} cm`,
        ],
        ["Test", diagnosticForm.testType],
        ["Request ID", diagnosticRequest?.id || "Unavailable"],
      ],
      readings: [
        {
          label: "Heart rate",
          value:
            resultVitals.heartRate === undefined
              ? "Not received"
              : `${resultVitals.heartRate} bpm`,
          reference: "60–100 bpm",
          status: rangeStatus(resultVitals.heartRate, 60, 100),
        },
        {
          label: "SpO₂",
          value:
            resultVitals.spo2 === undefined
              ? "Not received"
              : `${resultVitals.spo2}%`,
          reference: "95–100%",
          status: rangeStatus(resultVitals.spo2, 95, 100),
        },
        {
          label: "Temperature",
          value:
            resultVitals.temperature === undefined
              ? "Not received"
              : `${resultVitals.temperature} °C`,
          reference: "36.1–37.2 °C",
          status: rangeStatus(resultVitals.temperature, 36.1, 37.2),
        },
        {
          label: "Blood pressure",
          value:
            resultVitals.systolic === undefined
              ? "Not received"
              : `${resultVitals.systolic}/${resultVitals.diastolic ?? "—"} mmHg`,
          reference: "<120 / <80 mmHg",
          status: bloodPressureStatus(
            resultVitals.systolic,
            resultVitals.diastolic,
          ),
        },
        {
          label: "Fasting glucose",
          value:
            resultVitals.glucose === undefined
              ? "Not received"
              : `${resultVitals.glucose} mg/dL`,
          reference: "≤ 99 mg/dL",
          status: upperLimitStatus(resultVitals.glucose, 99),
        },
      ],
      aiText:
        diagnosticAi ||
        "## Summary\nAI analysis is still pending.\n## Advice\nReview the readings with a qualified clinician.",
      disclaimer:
        "Educational support only. Verify sensor calibration and measurement conditions. A qualified clinician must interpret abnormal results.",
      profile: {
        name: user.displayName || user.phoneNumber || diagnosticForm.name,
        photoURL: user.photoURL,
      },
    });
  }

  const healthCards = [
    {
      label: "Heart health",
      value: vitals.heartRate ?? 78,
      unit: "BPM",
      icon: HeartPulse,
      tone: "purple",
      status: "Normal",
    },
    {
      label: "Diabetes",
      value: vitals.glucose ?? 108,
      unit: "mg/dL",
      icon: Droplets,
      tone: "blue",
      status: "Normal",
    },
    {
      label: "Liver health",
      value: "Low",
      unit: "risk",
      icon: Activity,
      tone: "orange",
      status: "Stable",
    },
    {
      label: "Blood pressure",
      value: `${vitals.systolic ?? 121}/${vitals.diastolic ?? 79}`,
      unit: "mmHg",
      icon: Gauge,
      tone: "rose",
      status: "Normal",
    },
  ];

  const sensorCards = [
    {
      label: "Heart Rate",
      value: vitals.heartRate ?? 78,
      unit: "BPM",
      icon: HeartPulse,
      tone: "rose",
    },
    {
      label: "Temperature",
      value: vitals.temperature ?? 36.8,
      unit: "°C",
      icon: Thermometer,
      tone: "orange",
    },
    {
      label: "SpO₂",
      value: vitals.spo2 ?? 98,
      unit: "%",
      icon: Droplets,
      tone: "teal",
    },
    {
      label: "Blood Pressure",
      value: `${vitals.systolic ?? 121}/${vitals.diastolic ?? 79}`,
      unit: "mmHg",
      icon: Gauge,
      tone: "blue",
    },
  ];

  return (
    <div className={`app ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      {mobileOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="logo">
          <span>
            <HeartPulse size={22} />
          </span>
          <div>
            <strong>Sanjeevni-AI</strong>
            <small>AI Health</small>
          </div>
        </div>
        <button
          className="collapse-button"
          onClick={() => setSidebarOpen((value) => !value)}
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
        <nav className="side-nav">
          <p className="nav-label">Workspace</p>
          {navItems.slice(0, 6).map(({ name, icon: Icon }) => (
            <button
              className={activePage === name ? "active" : ""}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{language === "hi" ? hindiPages[name] : name}</span>
              {activePage === name && (
                <ChevronRight className="nav-arrow" size={15} />
              )}
            </button>
          ))}
          <p className="nav-label">Insights</p>
          {navItems.slice(6).map(({ name, icon: Icon }) => (
            <button
              className={activePage === name ? "active" : ""}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{language === "hi" ? hindiPages[name] : name}</span>
              {activePage === name && (
                <ChevronRight className="nav-arrow" size={15} />
              )}
            </button>
          ))}
        </nav>
        <div className="system-card">
          <div>
            <span className={`status-dot ${connection}`} />
            <strong>System status</strong>
          </div>
          <small>
            {connection === "live"
              ? dataStale
                ? "Firebase connected · hardware data stale"
                : "All services operational"
              : connection === "error"
                ? "Firebase connection failed"
                : "Demo mode active"}
          </small>
          <div className="system-meter">
            <span />
          </div>
        </div>
        <button className="profile" onClick={() => setProfileOpen(true)}>
          <span
            className="avatar"
            style={
              user?.photoURL
                ? {
                    backgroundImage: `url(${user.photoURL})`,
                    backgroundSize: "cover",
                  }
                : undefined
            }
          >
            {user?.photoURL
              ? ""
              : (user?.displayName || "Guest").slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>
              {user?.displayName ||
                (language === "hi"
                  ? "अपना प्रोफ़ाइल खोलें"
                  : "Open your profile")}
            </strong>
            <small>
              {user
                ? language === "hi"
                  ? "सुरक्षित स्वास्थ्य प्रोफ़ाइल"
                  : "Private health profile"
                : language === "hi"
                  ? "साइन इन करें"
                  : "Sign in"}
            </small>
          </div>
          <MoreHorizontal size={18} />
        </button>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)}>
            <Menu size={21} />
          </button>
          <div className="page-heading">
            <p>
              {language === "hi"
                ? "स्वास्थ्य कार्यक्षेत्र"
                : "Healthcare workspace"}
            </p>
            <h1>{language === "hi" ? hindiPages[activePage] : activePage}</h1>
          </div>
          <div className="top-actions">
            <label className="search-box">
              <Search size={17} />
              <input placeholder="Search anything..." />
            </label>
            <div className={`connection-pill ${connection}`}>
              {connection === "live" ? (
                <Wifi size={14} />
              ) : connection === "error" ? (
                <CloudOff size={14} />
              ) : (
                <Database size={14} />
              )}
              <span>
                {connection === "live"
                  ? "Firebase live"
                  : connection === "error"
                    ? "Offline"
                    : "Demo data"}
              </span>
            </div>
            <button
              className="icon-btn theme-toggle"
              onClick={() => setDark((value) => !value)}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="notification-wrap">
              <button
                className="icon-btn notification"
                aria-label="Notifications"
                aria-expanded={notificationOpen}
                onClick={() => setNotificationOpen((value) => !value)}
              >
                <Bell size={18} />
                {notifications.some((item) => item.unread) && (
                  <i>{notifications.filter((item) => item.unread).length}</i>
                )}
              </button>
              {notificationOpen && (
                <div className="notification-menu">
                  <div className="notification-head">
                    <div>
                      <strong>Notifications</strong>
                      <small>
                        {notifications.filter((item) => item.unread).length}{" "}
                        unread updates
                      </small>
                    </div>
                    <button
                      onClick={() => setNotificationOpen(false)}
                      aria-label="Close notifications"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="notification-list">
                    {notifications.length ? (
                      notifications.map((item) => (
                        <button
                          className={item.unread ? "unread" : ""}
                          key={item.id}
                          onClick={() =>
                            setNotifications((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, unread: false }
                                  : entry,
                              ),
                            )
                          }
                        >
                          <span className={`notification-symbol ${item.tone}`}>
                            <Activity size={15} />
                          </span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                            <small>{item.time}</small>
                          </div>
                          {item.unread && <i />}
                        </button>
                      ))
                    ) : (
                      <div className="notification-empty">
                        <Bell size={22} />
                        <span>You’re all caught up.</span>
                      </div>
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <div className="notification-footer">
                      <button
                        onClick={() =>
                          setNotifications((current) =>
                            current.map((item) => ({ ...item, unread: false })),
                          )
                        }
                      >
                        Mark all read
                      </button>
                      <button onClick={() => setNotifications([])}>
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          {activePage === "Dashboard" && (
            <>
              <section className="welcome-row">
                <div>
                  <span className="kicker">
                    <Sparkles size={14} /> Clinical intelligence
                  </span>
                  <h2>Good morning, Akshat.</h2>
                  <p>Here’s a calm, real-time view of your health signals.</p>
                </div>
                <div className="date-chip">
                  <ShieldCheck size={17} />
                  <span>
                    <small>Last health sync</small>Just now
                  </span>
                </div>
              </section>
              <section className="health-grid">
                {healthCards.map(
                  ({ label, value, unit, icon: Icon, tone, status }, index) => (
                    <article className={`health-card ${tone}`} key={label}>
                      <div className="card-top">
                        <span className="metric-icon">
                          <Icon size={20} />
                        </span>
                        <span className="trend">+2.4%</span>
                      </div>
                      <p>{label}</p>
                      <div className="metric">
                        <strong>{value}</strong>
                        <span>{unit}</span>
                      </div>
                      <div className="card-bottom">
                        <span className="normal-dot" />
                        {status}
                        <Sparkline index={index} />
                      </div>
                    </article>
                  ),
                )}
              </section>
              <section className="dashboard-grid">
                <article className="surface live-panel">
                  <div className="section-title">
                    <div>
                      <span className="kicker">Live monitoring</span>
                      <h3>Connected health sensors</h3>
                    </div>
                    <button onClick={() => navigate("Live IoT Monitoring")}>
                      View details <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="sensor-grid">
                    {sensorCards.map(
                      ({ label, value, unit, icon: Icon, tone }, index) => (
                        <div className={`sensor-card ${tone}`} key={label}>
                          <span>
                            <Icon size={17} />
                            {label}
                          </span>
                          <div>
                            <strong>{value}</strong>
                            <small>{unit}</small>
                          </div>
                          <Sparkline index={index + 1} />
                        </div>
                      ),
                    )}
                  </div>
                  <div className="ecg-strip">
                    <div>
                      <HeartPulse size={18} />
                      <span>
                        <strong>Live ECG</strong>
                        <small>Normal sinus rhythm</small>
                      </span>
                    </div>
                    <Sparkline />
                  </div>
                </article>
                <article className="surface activity-panel">
                  <div className="section-title">
                    <div>
                      <span className="kicker">Recent activity</span>
                      <h3>Health timeline</h3>
                    </div>
                    <button>
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  {[
                    [
                      "Heart screening",
                      "Low risk · 94% confidence",
                      "2 min",
                      "purple",
                    ],
                    [
                      "Blood report",
                      "OCR analysis completed",
                      "24 min",
                      "blue",
                    ],
                    [
                      "Sensor alert",
                      alerts[0] || "All vitals normal",
                      "1 hr",
                      alerts.length ? "orange" : "green",
                    ],
                  ].map(([title, detail, time, tone]) => (
                    <div className="activity-row" key={title}>
                      <span className={`activity-icon ${tone}`}>
                        <Activity size={16} />
                      </span>
                      <div>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </div>
                      <time>{time}</time>
                    </div>
                  ))}
                  <button
                    className="full-link"
                    onClick={() => navigate("History")}
                  >
                    View complete history <ChevronRight size={15} />
                  </button>
                </article>
              </section>
              <section className="insight-grid">
                <article className="surface ai-insight">
                  <span className="ai-orb">
                    <Sparkles size={22} />
                  </span>
                  <div>
                    <span className="kicker">AI Doctor insight</span>
                    <h3>Your readings look stable today</h3>
                    <p>
                      Heart rate, oxygen, temperature, and blood pressure remain
                      within configured screening thresholds.
                    </p>
                  </div>
                  <button
                    className="primary-btn"
                    onClick={() => navigate("AI Doctor")}
                  >
                    Ask AI Doctor
                  </button>
                </article>
                <article className="surface mini-stat">
                  <div>
                    <Zap size={19} />
                    <span>
                      <small>System performance</small>
                      <strong>99.9%</strong>
                    </span>
                  </div>
                  <div className="bar">
                    <span />
                  </div>
                  <p>API and monitoring services are healthy.</p>
                </article>
              </section>
            </>
          )}

          {activePage === "Disease Prediction" && (
            <section className="page-stack">
              <div className="hero-card prediction-hero">
                <div>
                  <span className="kicker">
                    <Dna size={14} /> Validated AI screening
                  </span>
                  <h2>Understand risk, earlier.</h2>
                  <p>
                    Select a screening model and enter the requested clinical
                    measurements. Your data is sent only to the local backend.
                  </p>
                </div>
                <span className="hero-icon">
                  <BrainCircuit size={46} />
                </span>
              </div>
              <article className="surface prediction-workspace">
                <div className="section-title">
                  <div>
                    <span className="kicker">Step 1</span>
                    <h3>Choose a health model</h3>
                  </div>
                </div>
                <div className="disease-tabs">
                  {["heart", "diabetes", "liver", "blood"].map((name) => (
                    <button
                      disabled={!models[name]?.ready}
                      className={selectedDisease === name ? "active" : ""}
                      key={name}
                      onClick={() => {
                        setSelectedDisease(name);
                        setValues({});
                        setPrediction(null);
                      }}
                    >
                      <HeartPulse size={18} />
                      <span>
                        {name}
                        <small>
                          {models[name]?.ready ? "Model ready" : "Unavailable"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
                {selectedModel?.ready ? (
                  <form onSubmit={runPrediction}>
                    <div className="form-heading">
                      <span className="kicker">Step 2</span>
                      <h3>Clinical inputs</h3>
                      <p>
                        Complete all {selectedModel.features.length} fields for
                        an accurate model response.
                      </p>
                    </div>
                    <div className="feature-grid">
                      {selectedModel.features.map((field) => (
                        <label key={field}>
                          <span>{formatField(field)}</span>
                          <input
                            type="number"
                            step="any"
                            required
                            placeholder="Enter value"
                            value={values[field] || ""}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      className="primary-btn predict-btn"
                      disabled={predicting}
                    >
                      {predicting ? (
                        <>
                          <LoaderCircle className="spin" size={18} /> Analyzing
                          health data...
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} /> Run AI screening
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="empty-state">
                    <AlertTriangle size={28} />
                    <h3>Model unavailable</h3>
                    <p>Start the backend or select an enabled model.</p>
                  </div>
                )}
                {predictionError && (
                  <div className="error-box">
                    <AlertTriangle size={18} />
                    {predictionError}
                  </div>
                )}
                {prediction && (
                  <div className="result-card">
                    <span className="result-ring">
                      {prediction.confidence === null
                        ? "—"
                        : `${Math.round(prediction.confidence * 100)}%`}
                    </span>
                    <div>
                      <span className="kicker">Screening result</span>
                      <h3>
                        {Number(prediction.prediction) === 0
                          ? "Low risk detected"
                          : "Elevated risk detected"}
                      </h3>
                      <p>
                        This model output is decision support—not a medical
                        diagnosis. Review it with a qualified clinician.
                      </p>
                    </div>
                  </div>
                )}
              </article>
            </section>
          )}

          {activePage === "Live IoT Monitoring" && (
            <section className="page-stack">
              <div className="monitor-header">
                <div>
                  <span className="kicker">
                    <span className={`status-dot ${connection}`} />{" "}
                    {connection === "live"
                      ? "Firebase connected"
                      : "Firebase connection issue"}
                  </span>
                  <h2>{vitals.deviceId || "Raspberry Pi Health Hub"}</h2>
                  <p>
                    {connection === "error"
                      ? "The Firebase listener could not connect."
                      : dataStale
                        ? "Firebase is accessible, but the hardware has not sent a fresh reading recently."
                        : "Firebase is pushing fresh hardware readings directly to this dashboard."}
                  </p>
                </div>
                <div className="monitor-actions">
                  <div className="device-meta">
                    <span>
                      <small>Data age</small>
                      {formatDataAge(vitals.timestamp)}
                    </span>
                    <span>
                      <small>Buffer</small>
                      {vitalsHistory.length} points
                    </span>
                    <span>
                      <small>Stream</small>
                      {connection === "error"
                        ? "Disconnected"
                        : dataStale
                          ? "Connected · stale"
                          : "Live"}
                    </span>
                  </div>
                  <div className="diagnostic-actions">
                    <button
                      className="secondary-btn"
                      onClick={() => setDiagnosticOpen(true)}
                    >
                      <ClipboardPlus size={16} /> New diagnostic
                    </button>
                    <button
                      className="primary-btn"
                      disabled={iotReportWorking}
                      onClick={downloadIoTReport}
                    >
                      {iotReportWorking ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Download size={16} />
                      )}{" "}
                      {iotReportWorking
                        ? "Generating AI report..."
                        : "Generate AI report"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="health-grid">
                {sensorCards.map(
                  ({ label, value, unit, icon: Icon, tone }, index) => (
                    <article className={`health-card ${tone}`} key={label}>
                      <div className="card-top">
                        <span className="metric-icon">
                          <Icon size={20} />
                        </span>
                        <span className="live-label">LIVE</span>
                      </div>
                      <p>{label}</p>
                      <div className="metric">
                        <strong>{value}</strong>
                        <span>{unit}</span>
                      </div>
                      <Sparkline index={index} />
                    </article>
                  ),
                )}
              </div>
              <div className="iot-grid">
                <article className="surface waveform-card">
                  <div className="section-title">
                    <div>
                      <span className="kicker">Rolling telemetry</span>
                      <h3>Temperature trend · last 60 readings</h3>
                    </div>
                    <span
                      className={`normal-badge ${dataStale || connection === "error" ? "stale" : ""}`}
                    >
                      {connection === "error"
                        ? "Firebase disconnected"
                        : dataStale
                          ? "Connected · old hardware data"
                          : "Receiving fresh data"}
                    </span>
                  </div>
                  <HistoryChart points={vitalsHistory} />
                </article>
                <article className="surface device-card">
                  <span className="kicker">Device details</span>
                  <h3>Connection overview</h3>
                  <dl>
                    <div>
                      <dt>Firebase</dt>
                      <dd>
                        <span className={`status-dot ${connection}`} />
                        {connection === "live" ? "connected" : connection}
                      </dd>
                    </div>
                    <div>
                      <dt>Hardware stream</dt>
                      <dd>{dataStale ? "stale" : "fresh"}</dd>
                    </div>
                    <div>
                      <dt>Patient</dt>
                      <dd>{vitals.patientId || "Not supplied"}</dd>
                    </div>
                    <div>
                      <dt>Firebase region</dt>
                      <dd>us-central1</dd>
                    </div>
                    <div>
                      <dt>Data age</dt>
                      <dd>{formatDataAge(vitals.timestamp)}</dd>
                    </div>
                    <div>
                      <dt>Received locally</dt>
                      <dd>
                        {lastReceivedAt
                          ? new Date(lastReceivedAt).toLocaleTimeString("en-IN")
                          : "Waiting"}
                      </dd>
                    </div>
                  </dl>
                </article>
              </div>
              <article className="surface reference-panel">
                <div className="section-title">
                  <div>
                    <span className="kicker">Reading guide</span>
                    <h3>Your latest values vs general adult references</h3>
                  </div>
                  <button onClick={downloadIoTReport}>
                    <Download size={15} /> Download PDF
                  </button>
                </div>
                <div className="live-reference-grid">
                  <LiveReference
                    label="Heart rate"
                    value={vitals.heartRate}
                    unit="bpm"
                    reference="60–100"
                  />
                  <LiveReference
                    label="SpO₂"
                    value={vitals.spo2}
                    unit="%"
                    reference="95–100"
                  />
                  <LiveReference
                    label="Temperature"
                    value={vitals.temperature}
                    unit="°C"
                    reference="36.1–37.2"
                  />
                  <LiveReference
                    label="Blood pressure"
                    value={
                      vitals.systolic === undefined
                        ? undefined
                        : `${vitals.systolic}/${vitals.diastolic ?? "—"}`
                    }
                    unit="mmHg"
                    reference="<120 / <80"
                  />
                </div>
                <p className="reference-note">
                  General educational references only. Measurement conditions
                  and clinician-specified targets take priority.
                </p>
              </article>
            </section>
          )}

          {activePage === "Medical Report Analysis" && (
            <OcrWorkspace
              user={user}
              onRequireSignIn={() => setProfileOpen(true)}
              onSendToDoctor={sendOcrToDoctor}
              onFindDoctor={() => navigate("Verified Doctors")}
            />
          )}
          {activePage === "AI Doctor" && (
            <section className="doctor-layout">
              <article className="doctor-avatar-card">
                <div className="avatar-glow" />
                <div className="doctor-figure">
                  <span>AI</span>
                  <Stethoscope size={48} />
                </div>
                <span className="online-badge">
                  <i /> Sanjeevni-AI is online
                </span>
                <h2>Your intelligent health companion</h2>
                <p>
                  Private, educational support for reports, vitals, and health
                  questions.
                </p>
                <div className="doctor-stats">
                  <span>
                    <strong>24/7</strong>
                    <small>Available</small>
                  </span>
                  <span>
                    <strong>10+</strong>
                    <small>Health areas</small>
                  </span>
                </div>
              </article>
              <article className="surface chat-panel">
                <div className="chat-head">
                  <div>
                    <span className="ai-orb small">
                      <Sparkles size={17} />
                    </span>
                    <span>
                      <strong>AI Doctor · NVIDIA NIM</strong>
                      <small>
                        {doctorWorking
                          ? "Analyzing your question..."
                          : "Educational guidance, not diagnosis"}
                      </small>
                    </span>
                  </div>
                  <div className="doctor-menu-wrap">
                    <button
                      onClick={() => setDoctorMenuOpen((open) => !open)}
                      aria-label="AI Doctor chat menu"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {doctorMenuOpen && (
                      <div className="doctor-menu">
                        <div className="doctor-menu-title">
                          <strong>Chat history</strong>
                          <small>{chat.length} messages in this session</small>
                        </div>
                        <div className="doctor-history-list">
                          {chat
                            .filter((message) => message.role === "user")
                            .slice(-5)
                            .reverse()
                            .map((message, index) => (
                              <button
                                key={`${message.text}-${index}`}
                                onClick={() => {
                                  setChatInput(message.text.replace(/\n📎.*$/, ""));
                                  setDoctorMenuOpen(false);
                                }}
                              >
                                <History size={14} />
                                <span>{message.text.replace(/\n📎.*$/, "")}</span>
                              </button>
                            ))}
                          {!chat.some((message) => message.role === "user") && (
                            <p>No user questions yet.</p>
                          )}
                        </div>
                        <button onClick={toggleLiveVoiceChat}>
                          {liveVoiceMode ? <MicOff size={15} /> : <Mic size={15} />}
                          {liveVoiceMode ? "Stop live voice chat" : "Start live voice chat"}
                        </button>
                        <button
                          onClick={() => {
                            const lastAnswer = [...chat]
                              .reverse()
                              .find((message) => message.role === "assistant");
                            if (lastAnswer) speakDoctorAnswer(lastAnswer.text);
                            setDoctorMenuOpen(false);
                          }}
                        >
                          <Volume2 size={15} /> Read last answer
                        </button>
                        <button onClick={exportDoctorChat}>
                          <Download size={15} /> Export chat
                        </button>
                        <button className="danger" onClick={clearDoctorChat}>
                          <Trash2 size={15} /> Clear session
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {voiceNotice && (
                  <div className="voice-notice">
                    <AlertTriangle size={15} />
                    <span>{voiceNotice}</span>
                  </div>
                )}
                {liveVoiceMode && (
                  <div className="voice-live-banner">
                    <Mic size={15} />
                    Live voice chat is on. Speak naturally; AI answers will be
                    read aloud.
                  </div>
                )}
                <div className="messages">
                  {chat.map((message, index) => (
                    <div
                      className={`message ${message.role} ${importantMessages.has(index) ? "saved-important" : ""}`}
                      key={`${message.role}-${index}`}
                    >
                      {message.role === "assistant" ? (
                        <FormattedDoctorResponse text={message.text} />
                      ) : (
                        <p>{message.text}</p>
                      )}
                      <div className="message-meta">
                        <time>
                          {message.role === "assistant" ? "AI Doctor" : "You"} ·
                          now
                        </time>
                        {message.role === "assistant" && (
                          <div className="message-actions">
                            <button
                              onClick={() =>
                                copyDoctorMessage(message.text, index)
                              }
                            >
                              {copiedMessage === index ? (
                                <Check size={13} />
                              ) : (
                                <Copy size={13} />
                              )}
                              {copiedMessage === index ? "Copied" : "Copy"}
                            </button>
                            <button
                              disabled={doctorWorking}
                              onClick={() => askAgain(index)}
                            >
                              <RotateCcw size={13} />
                              Ask again
                            </button>
                            <button
                              className={
                                importantMessages.has(index) ? "active" : ""
                              }
                              onClick={() => toggleImportant(index)}
                            >
                              <Bookmark size={13} />
                              Important
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {doctorWorking && (
                    <div className="message assistant">
                      <p>
                        <LoaderCircle className="spin" size={17} /> Thinking
                        carefully...
                      </p>
                    </div>
                  )}
                </div>
                <div className="suggestions">
                  {[
                    "Explain my vitals",
                    "Review a report",
                    "Healthy heart tips",
                  ].map((text) => (
                    <button key={text} onClick={() => setChatInput(text)}>
                      {text}
                    </button>
                  ))}
                </div>
                {attachment && (
                  <div className={`attachment-chip ${attachment.status}`}>
                    {attachment.preview &&
                    attachment.type.startsWith("image/") ? (
                      <img src={attachment.preview} alt="" />
                    ) : (
                      <span className="attachment-type">
                        {attachment.type.startsWith("video/") ? (
                          <Video size={17} />
                        ) : attachment.type === "application/pdf" ? (
                          <FileText size={17} />
                        ) : (
                          <ImageIcon size={17} />
                        )}
                      </span>
                    )}
                    <div>
                      <strong>{attachment.name}</strong>
                      <small>
                        {attachment.status === "processing"
                          ? "Reading file locally..."
                          : attachment.status === "error"
                            ? attachment.context
                            : `${(attachment.size / 1024).toFixed(0)} KB · Ready`}
                      </small>
                    </div>
                    {attachment.status === "processing" && (
                      <LoaderCircle className="spin" size={16} />
                    )}
                    <button
                      onClick={() => setAttachment(null)}
                      aria-label="Remove attachment"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                <form className="chat-input" onSubmit={sendMessage}>
                  <input
                    ref={attachmentInput}
                    className="chat-file-input"
                    type="file"
                    accept="image/*,application/pdf,text/*,.csv,.json,.md,video/*"
                    onChange={chooseChatAttachment}
                  />
                  <button
                    type="button"
                    className="attach-btn"
                    onClick={() => attachmentInput.current?.click()}
                    aria-label="Attach image, PDF, file, or video"
                  >
                    <Paperclip size={19} />
                  </button>
                  <button
                    type="button"
                    className={`attach-btn ${voiceListening ? "listening" : ""}`}
                    onClick={toggleVoiceInput}
                    aria-label="Voice to text"
                    title="Voice to text"
                  >
                    {voiceListening ? <MicOff size={19} /> : <Mic size={19} />}
                  </button>
                  <button
                    type="button"
                    className="attach-btn live-vitals-btn"
                    onClick={addLiveVitalsToChat}
                    aria-label="Add live vitals"
                    title="Add live vitals"
                  >
                    <Activity size={19} />
                  </button>
                  <input
                    disabled={doctorWorking}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Ask or attach a health report..."
                  />
                  <button
                    className="send-btn"
                    disabled={
                      doctorWorking || attachment?.status === "processing"
                    }
                  >
                    <ChevronRight size={20} />
                  </button>
                </form>
              </article>
            </section>
          )}
          {activePage === "Verified Doctors" && (
            <VerifiedDoctorsView
              user={user}
              onRequireSignIn={() => setProfileOpen(true)}
            />
          )}
          {activePage === "History" &&
            (user ? (
              <HistoryView />
            ) : (
              <SignInGate
                onOpen={() => setProfileOpen(true)}
                language={language}
              />
            ))}
          {activePage === "Analytics" && <AnalyticsView />}
          {activePage === "Settings" && (
            <SettingsView dark={dark} setDark={setDark} />
          )}
          {activePage === "About" && <AboutView />}
        </main>
        <ProfilePanel
          open={profileOpen}
          user={user}
          onClose={() => setProfileOpen(false)}
          onNavigate={navigate}
          language={language}
          setLanguage={setLanguage}
        />
        {diagnosticOpen && (
          <div
            className="diagnostic-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="New hardware diagnostic"
          >
            <button
              className="diagnostic-backdrop"
              onClick={() => setDiagnosticOpen(false)}
              aria-label="Close diagnostic"
            />
            <section className="diagnostic-modal surface">
              <div className="diagnostic-modal-head">
                <div>
                  <span className="kicker">
                    <ClipboardPlus size={14} /> Hardware diagnostic request
                  </span>
                  <h2>Start a new body test</h2>
                  <p>
                    Patient details stay in the private Firebase diagnostic
                    queue for the connected hardware.
                  </p>
                </div>
                <button
                  onClick={() => setDiagnosticOpen(false)}
                  aria-label="Close"
                >
                  <X size={19} />
                </button>
              </div>
              {!diagnosticRequest ? (
                <form onSubmit={submitDiagnosticRequest}>
                  <div className="diagnostic-form-grid">
                    <label>
                      <span>Patient name</span>
                      <input
                        required
                        value={diagnosticForm.name}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Age</span>
                      <input
                        required
                        type="number"
                        min="1"
                        max="120"
                        value={diagnosticForm.age}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            age: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Gender</span>
                      <select
                        required
                        value={diagnosticForm.gender}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            gender: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select</option>
                        <option>Female</option>
                        <option>Male</option>
                        <option>Other</option>
                        <option>Prefer not to say</option>
                      </select>
                    </label>
                    <label>
                      <span>Blood group</span>
                      <select
                        required
                        value={diagnosticForm.bloodGroup}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            bloodGroup: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select</option>
                        {[
                          "A+",
                          "A-",
                          "B+",
                          "B-",
                          "AB+",
                          "AB-",
                          "O+",
                          "O-",
                          "Unknown",
                        ].map((group) => (
                          <option key={group}>{group}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Weight (kg)</span>
                      <input
                        required
                        type="number"
                        min="2"
                        max="400"
                        step="0.1"
                        value={diagnosticForm.weight}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            weight: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Height (cm)</span>
                      <input
                        type="number"
                        min="30"
                        max="250"
                        value={diagnosticForm.height}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            height: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="full">
                      <span>Diagnostic test</span>
                      <select
                        value={diagnosticForm.testType}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            testType: event.target.value,
                          }))
                        }
                      >
                        <option>Complete vitals</option>
                        <option>Heart and SpO₂</option>
                        <option>Temperature screening</option>
                        <option>Blood pressure</option>
                        <option>Glucose screening</option>
                      </select>
                    </label>
                    <label className="full">
                      <span>Symptoms or notes</span>
                      <textarea
                        maxLength={500}
                        value={diagnosticForm.notes}
                        onChange={(event) =>
                          setDiagnosticForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        placeholder="Optional context for the diagnostic..."
                      />
                    </label>
                  </div>
                  <label className="consent-row">
                    <input
                      type="checkbox"
                      checked={diagnosticForm.consent}
                      onChange={(event) =>
                        setDiagnosticForm((current) => ({
                          ...current,
                          consent: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      I have patient consent to collect and process these sensor
                      readings.
                    </span>
                  </label>
                  {diagnosticError && (
                    <div className="error-box">
                      <AlertTriangle size={17} />
                      {diagnosticError}
                    </div>
                  )}
                  <button
                    className="primary-btn diagnostic-submit"
                    disabled={diagnosticSubmitting || !diagnosticForm.consent}
                  >
                    {diagnosticSubmitting ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <ClipboardPlus size={17} />
                    )}
                    {diagnosticSubmitting
                      ? "Sending to Firebase..."
                      : "Send request to hardware"}
                  </button>
                </form>
              ) : (
                <div className="diagnostic-progress">
                  <span
                    className={`diagnostic-status-icon ${diagnosticRequest.status}`}
                  >
                    {diagnosticRequest.status === "completed" ? (
                      <Check size={28} />
                    ) : (
                      <LoaderCircle className="spin" size={28} />
                    )}
                  </span>
                  <span className="kicker">
                    Request {diagnosticRequest.id.slice(0, 8)}
                  </span>
                  <h3>
                    {diagnosticRequest.status === "completed"
                      ? "Diagnostic completed"
                      : "Waiting for connected hardware"}
                  </h3>
                  <p>
                    {diagnosticRequest.status === "completed"
                      ? "Firebase returned the hardware readings and AI analysis has started."
                      : "The request is in Firebase. Keep the hardware online while it measures and uploads the result."}
                  </p>
                  {diagnosticError && (
                    <div className="error-box">
                      <AlertTriangle size={17} />
                      {diagnosticError}
                    </div>
                  )}
                  {diagnosticResult && (
                    <div className="diagnostic-result">
                      <div>
                        <small>Hardware result</small>
                        <pre>{JSON.stringify(diagnosticResult, null, 2)}</pre>
                      </div>
                      <div>
                        <small>AI analysis</small>
                        {diagnosticAi ? (
                          <FormattedDoctorResponse text={diagnosticAi} />
                        ) : (
                          <p>
                            <LoaderCircle className="spin" size={15} />{" "}
                            Generating summary and advice...
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {diagnosticResult && (
                    <button
                      className="primary-btn"
                      onClick={downloadDiagnosticReport}
                    >
                      <Download size={16} /> Download diagnostic report
                    </button>
                  )}
                  <button
                    className="secondary-btn"
                    onClick={() => {
                      setDiagnosticRequest(null);
                      setDiagnosticResult(null);
                      setDiagnosticAi("");
                      setDiagnosticError("");
                    }}
                  >
                    Start another diagnostic
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function SignInGate({
  onOpen,
  language,
}: {
  onOpen: () => void;
  language: "en" | "hi";
}) {
  return (
    <section className="surface signin-gate">
      <ShieldCheck size={34} />
      <h2>
        {language === "hi"
          ? "आपकी रिपोर्ट निजी हैं"
          : "Your reports are private"}
      </h2>
      <p>
        {language === "hi"
          ? "अपनी रिपोर्ट और स्वास्थ्य इतिहास देखने के लिए Google या मोबाइल नंबर से साइन इन करें।"
          : "Sign in with Google or your mobile number to view your reports and health history."}
      </p>
      <button className="primary-btn" onClick={onOpen}>
        {language === "hi" ? "साइन इन करें" : "Sign in"}
      </button>
    </section>
  );
}

function rangeStatus(
  value: number | undefined,
  min: number,
  max: number,
): ReportReading["status"] {
  if (value === undefined) return "Unavailable";
  if (value < min) return "Low";
  if (value > max) return "High";
  return "Normal";
}

function upperLimitStatus(
  value: number | undefined,
  max: number,
): ReportReading["status"] {
  if (value === undefined) return "Unavailable";
  return value > max ? "High" : "Normal";
}

function bloodPressureStatus(
  systolic?: number,
  diastolic?: number,
): ReportReading["status"] {
  if (systolic === undefined || diastolic === undefined) return "Unavailable";
  return systolic >= 120 || diastolic >= 80 ? "High" : "Normal";
}

function InlineBold({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .filter(Boolean)
        .map((part, index) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={index}>{part.slice(2, -2)}</strong>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
    </>
  );
}

function FormattedDoctorResponse({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="formatted-response">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div className="response-space" key={index} />;
        if (line.startsWith("### "))
          return (
            <h4 key={index}>
              <InlineBold text={line.slice(4)} />
            </h4>
          );
        if (line.startsWith("## "))
          return (
            <h3 key={index}>
              <InlineBold text={line.slice(3)} />
            </h3>
          );
        if (line.startsWith("# "))
          return (
            <h2 key={index}>
              <InlineBold text={line.slice(2)} />
            </h2>
          );
        if (/^[-*•]\s+/.test(line))
          return (
            <div className="response-bullet" key={index}>
              <i />
              <p>
                <InlineBold text={line.replace(/^[-*•]\s+/, "")} />
              </p>
            </div>
          );
        if (/^\d+[.)]\s+/.test(line))
          return (
            <div className="response-step" key={index}>
              <b>{line.match(/^\d+/)?.[0]}</b>
              <p>
                <InlineBold text={line.replace(/^\d+[.)]\s+/, "")} />
              </p>
            </div>
          );
        const isImportant =
          /(important|warning|caution|emergency|seek immediate|consult a doctor|doctor immediately|तुरंत|सावधान)/i.test(
            line,
          );
        return (
          <p className={isImportant ? "important-line" : ""} key={index}>
            <InlineBold text={line} />
          </p>
        );
      })}
    </div>
  );
}

function formatDataAge(timestamp?: string) {
  if (!timestamp) return "Unavailable";
  const milliseconds = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return "Invalid time";
  if (milliseconds < 0) return "Clock ahead";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)} sec`;
  if (milliseconds < 3_600_000)
    return `${Math.floor(milliseconds / 60_000)} min`;
  return `${Math.floor(milliseconds / 3_600_000)} hr`;
}

function HistoryChart({ points }: { points: VitalsPoint[] }) {
  const values = points
    .map((point) => point.temperature)
    .filter((value): value is number => value !== undefined);
  if (values.length < 2)
    return (
      <div className="chart-waiting">
        <LoaderCircle className="spin" size={22} />
        <strong>Waiting for live history</strong>
        <span>The chart appears after two hardware readings arrive.</span>
      </div>
    );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.2);
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 900;
      const y = 165 - ((value - min) / spread) * 130;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="history-chart">
      <div className="chart-range">
        <span>{max.toFixed(1)}°</span>
        <span>{min.toFixed(1)}°</span>
      </div>
      <svg
        className="ecg-large"
        viewBox="0 0 900 180"
        preserveAspectRatio="none"
      >
        <path d={path} />
      </svg>
      <div className="chart-footer">
        <span>Older</span>
        <strong>{values.at(-1)?.toFixed(2)} °C latest</strong>
        <span>Now</span>
      </div>
    </div>
  );
}

function LiveReference({
  label,
  value,
  unit,
  reference,
}: {
  label: string;
  value: number | string | undefined;
  unit: string;
  reference: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value ?? "Not received"}{" "}
        <small>{value === undefined ? "" : unit}</small>
      </strong>
      <p>
        Reference{" "}
        <b>
          {reference} {unit}
        </b>
      </p>
    </div>
  );
}

function HistoryView() {
  const records = [
    [
      "Heart disease screening",
      "Low-risk result recorded",
      "Screening",
      "Today",
    ],
    [
      "Medical report OCR",
      "Analysis completed successfully",
      "Report",
      "Yesterday",
    ],
    [
      "AI Doctor conversation",
      "4 health questions answered",
      "Conversation",
      "2 days ago",
    ],
    [
      "Live sensor session",
      "42 minutes of vitals recorded",
      "Monitoring",
      "3 days ago",
    ],
    [
      "Diabetes screening",
      "Low-risk result recorded",
      "Screening",
      "4 days ago",
    ],
  ];
  const [query, setQuery] = useState("");
  const filtered = records.filter((record) =>
    record.join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  function exportCsv() {
    const content = [
      "Activity,Detail,Category,Date",
      ...records.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    link.download = "sanjeevni-ai-health-history.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function exportPdf() {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.setFontSize(18);
    pdf.text("Sanjeevni-AI Health History", 15, 18);
    pdf.setFontSize(10);
    records.forEach((record, index) =>
      pdf.text(
        `${record[3]} — ${record[0]}: ${record[1]}`,
        15,
        32 + index * 10,
      ),
    );
    pdf.save("sanjeevni-ai-health-history.pdf");
  }
  return (
    <section className="page-stack">
      <div className="toolbar-card">
        <label className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search diagnoses, reports, or conversations..."
          />
        </label>
        <div className="export-actions">
          <button className="secondary-btn" onClick={exportCsv}>
            <FileClock size={17} /> Export CSV
          </button>
          <button className="secondary-btn" onClick={exportPdf}>
            <FileClock size={17} /> Export PDF
          </button>
        </div>
      </div>
      <article className="surface table-card">
        <div className="section-title">
          <div>
            <span className="kicker">Patient timeline</span>
            <h3>Recent health activity</h3>
          </div>
        </div>
        {filtered.map(([item, detail, category, date], index) => (
          <div className="history-row" key={item}>
            <span
              className={`activity-icon ${["purple", "blue", "green"][index % 3]}`}
            >
              <Activity size={17} />
            </span>
            <div>
              <strong>{item}</strong>
              <small>{detail}</small>
            </div>
            <span className="category">{category}</span>
            <time>{date}</time>
            <button>
              <MoreHorizontal size={18} />
            </button>
          </div>
        ))}
        {!filtered.length && (
          <div className="empty-state">
            <Search size={25} />
            <h3>No matching activity</h3>
            <p>Try a different search term.</p>
          </div>
        )}
      </article>
    </section>
  );
}

function AnalyticsView() {
  return (
    <section className="page-stack">
      <div className="analytics-kpis">
        {[
          ["Total screenings", "128", "+12%"],
          ["Reports processed", "46", "+8%"],
          ["Sensor uptime", "99.9%", "+0.4%"],
          ["AI conversations", "84", "+18%"],
        ].map(([label, value, trend]) => (
          <article className="surface" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{trend} this month</small>
          </article>
        ))}
      </div>
      <div className="analytics-grid">
        <article className="surface chart-card">
          <div className="section-title">
            <div>
              <span className="kicker">Health activity</span>
              <h3>Screenings over time</h3>
            </div>
          </div>
          <div className="bar-chart">
            {[45, 65, 48, 82, 62, 90, 76, 95, 68, 88, 72, 98].map(
              (height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ),
            )}
          </div>
          <div className="chart-labels">
            <span>Jan</span>
            <span>Mar</span>
            <span>May</span>
            <span>Jul</span>
            <span>Sep</span>
            <span>Dec</span>
          </div>
        </article>
        <article className="surface distribution-card">
          <span className="kicker">Distribution</span>
          <h3>Screening categories</h3>
          <div className="donut">
            <div>
              <strong>128</strong>
              <small>Total</small>
            </div>
          </div>
          {[
            ["Heart", "42%", "purple"],
            ["Diabetes", "31%", "blue"],
            ["Liver", "18%", "orange"],
            ["Blood", "9%", "rose"],
          ].map(([name, value, tone]) => (
            <p key={name}>
              <i className={tone} />
              {name}
              <strong>{value}</strong>
            </p>
          ))}
        </article>
      </div>
    </section>
  );
}

function VerifiedDoctorsView({
  user,
  onRequireSignIn,
}: {
  user: User | null;
  onRequireSignIn: () => void;
}) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [appointment, setAppointment] = useState({
    date: "",
    time: "",
    mode: "Video consultation",
    reason: "",
    shareReport: false,
    shareLocation: false,
    consent: false,
  });
  const [patientLocation, setPatientLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [locationWorking, setLocationWorking] = useState(false);
  const [bookingWorking, setBookingWorking] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingConfirmation, setBookingConfirmation] = useState("");
  const [appointments, setAppointments] = useState<
    Array<{
      id: string;
      preferredDate: string;
      preferredTime: string;
      mode: string;
      status: string;
    }>
  >([]);
  const doctorEmail =
    process.env.NEXT_PUBLIC_SAMPLE_DOCTOR_EMAIL || "appointments@example.com";
  const doctorWhatsApp = (
    process.env.NEXT_PUBLIC_SAMPLE_DOCTOR_WHATSAPP || ""
  ).replace(/\D/g, "");

  useEffect(() => {
    const database = getRealtimeDatabase();
    if (!user || !database) return;
    get(ref(database, `users/${user.uid}/appointments`))
      .then((snapshot) => {
        const value = snapshot.val() as Record<
          string,
          {
            preferredDate?: string;
            preferredTime?: string;
            mode?: string;
            status?: string;
          }
        > | null;
        setAppointments(
          value
            ? Object.entries(value)
                .map(([id, item]) => ({
                  id,
                  preferredDate: item.preferredDate || "",
                  preferredTime: item.preferredTime || "",
                  mode: item.mode || "Consultation",
                  status: item.status || "requested",
                }))
                .reverse()
            : [],
        );
      })
      .catch(() => setAppointments([]));
  }, [user]);

  function beginBooking() {
    if (!user) return onRequireSignIn();
    setBookingError("");
    setBookingConfirmation("");
    setBookingOpen(true);
  }

  function appointmentMessage() {
    return [
      "Sanjeevni-AI appointment request",
      "Doctor: Dr. Ananya Mehta (sample profile)",
      `Patient: ${user?.displayName || user?.email || user?.phoneNumber || "Authenticated patient"}`,
      `Preferred slot: ${appointment.date || "Not selected"} ${appointment.time || ""}`,
      `Mode: ${appointment.mode}`,
      `Reason: ${appointment.reason || "Not supplied"}`,
      `Report sharing requested: ${appointment.shareReport ? "Yes — patient will choose the report separately" : "No"}`,
      `Location: ${appointment.shareLocation && patientLocation ? `https://maps.google.com/?q=${patientLocation.latitude},${patientLocation.longitude}` : "Not shared"}`,
      "Please confirm availability. No medical report is attached automatically.",
    ].join("\n");
  }

  function requestLocation() {
    if (!navigator.geolocation)
      return setBookingError("Location is not supported by this browser.");
    setLocationWorking(true);
    setBookingError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPatientLocation({
          latitude: Number(coords.latitude.toFixed(6)),
          longitude: Number(coords.longitude.toFixed(6)),
          accuracy: Math.round(coords.accuracy),
        });
        setAppointment((current) => ({ ...current, shareLocation: true }));
        setLocationWorking(false);
      },
      (error) => {
        setAppointment((current) => ({ ...current, shareLocation: false }));
        setBookingError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. You can continue without sharing it."
            : "Current location could not be detected.",
        );
        setLocationWorking(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
    );
  }

  async function submitAppointment(channel: "email" | "whatsapp") {
    if (!user) return onRequireSignIn();
    if (!appointment.date || !appointment.time)
      return setBookingError("Select a preferred date and time.");
    if (!appointment.consent)
      return setBookingError("Appointment consent is required.");
    if (
      new Date(`${appointment.date}T${appointment.time}`).getTime() <=
      Date.now()
    )
      return setBookingError("Choose a future appointment time.");
    setBookingWorking(true);
    setBookingError("");
    try {
      const database = getRealtimeDatabase();
      if (!database) throw new Error("Firebase is not configured.");
      const target = push(ref(database, `users/${user.uid}/appointments`));
      await set(target, {
        doctorId: "sample-dr-ananya-mehta",
        doctorName: "Dr. Ananya Mehta",
        patientName:
          user.displayName ||
          user.email ||
          user.phoneNumber ||
          "Authenticated patient",
        preferredDate: appointment.date,
        preferredTime: appointment.time,
        mode: appointment.mode,
        reason: appointment.reason.trim(),
        reportSharingRequested: appointment.shareReport,
        reportShared: false,
        location:
          appointment.shareLocation && patientLocation ? patientLocation : null,
        locationConsent: appointment.shareLocation && Boolean(patientLocation),
        consent: true,
        consentAt: new Date().toISOString(),
        contactChannel: channel,
        status: "requested",
        createdAt: new Date().toISOString(),
      });
      const reference = target.key || `APT-${Date.now()}`;
      setBookingConfirmation(reference);
      setAppointments((current) => [
        {
          id: reference,
          preferredDate: appointment.date,
          preferredTime: appointment.time,
          mode: appointment.mode,
          status: "requested",
        },
        ...current,
      ]);
      const message = `${appointmentMessage()}\nAppointment reference: ${reference}`;
      if (channel === "email") {
        window.location.href = `mailto:${doctorEmail}?subject=${encodeURIComponent(`Sanjeevni-AI appointment ${reference}`)}&body=${encodeURIComponent(message)}`;
      } else {
        const url = doctorWhatsApp
          ? `https://wa.me/${doctorWhatsApp}?text=${encodeURIComponent(message)}`
          : `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setBookingError(
        error instanceof Error
          ? error.message
          : "Could not save the appointment request.",
      );
    } finally {
      setBookingWorking(false);
    }
  }

  return (
    <section className="page-stack doctors-page">
      <div className="hero-card doctors-hero">
        <div>
          <span className="kicker">
            <BadgeCheck size={14} /> Professional care network
          </span>
          <h2>Connect with a qualified doctor.</h2>
          <p>
            Choose a verified professional, request a convenient slot, and
            decide exactly which report you want to share.
          </p>
        </div>
        <span className="hero-icon">
          <Stethoscope size={46} />
        </span>
      </div>
      <div className="doctor-directory-head">
        <div>
          <h3>Available doctors</h3>
          <p>Sample layout for the future verified-doctor directory.</p>
        </div>
        <span>
          <ShieldCheck size={15} /> Registration must be independently verified
        </span>
      </div>
      <article className="surface professional-doctor-card">
        <div className="doctor-photo">
          <span>AM</span>
          <i>
            <BadgeCheck size={15} />
          </i>
        </div>
        <div className="doctor-primary">
          <div className="sample-label">
            Sample profile · Not a real listing
          </div>
          <h3>Dr. Ananya Mehta</h3>
          <strong>General Physician · Internal Medicine</strong>
          <p>
            <MapPin size={14} /> New Delhi · Hindi, English
          </p>
          <div className="doctor-tags">
            <span>MBBS, MD</span>
            <span>12 years experience</span>
            <span>Video & clinic</span>
          </div>
        </div>
        <div className="doctor-verification">
          <span>
            <BadgeCheck size={16} /> Verification preview
          </span>
          <p>
            <b>Registration</b> DEMO-NMC-0001
          </p>
          <p>
            <b>Affiliation</b> Sample Health Clinic
          </p>
          <small>
            Real doctors will appear only after registration and identity
            checks.
          </small>
        </div>
        <div className="doctor-booking">
          <div>
            <Star size={16} />
            <strong>4.9</strong>
            <small>Sample rating</small>
          </div>
          <p>
            <Clock size={15} /> Next slot: Tomorrow, 10:30 AM
          </p>
          <p>
            <IndianRupee size={15} /> Consultation: ₹599
          </p>
          <button className="primary-btn" onClick={beginBooking}>
            <CalendarDays size={16} /> Request appointment
          </button>
        </div>
      </article>
      <div className="doctor-safety-note">
        <ShieldCheck size={18} />
        <p>
          <strong>Your reports remain private.</strong> An appointment request
          never sends a report automatically. Select and consent to each report
          separately after the doctor confirms the appointment.
        </p>
      </div>
      {user && appointments.length > 0 && (
        <article className="surface appointment-history">
          <div className="section-title">
            <div>
              <span className="kicker">Private account</span>
              <h3>My appointment requests</h3>
            </div>
            <span>{appointments.length} saved</span>
          </div>
          {appointments.slice(0, 5).map((item) => (
            <div className="appointment-history-row" key={item.id}>
              <span>
                <CalendarDays size={17} />
              </span>
              <div>
                <strong>Dr. Ananya Mehta</strong>
                <small>
                  {item.preferredDate} · {item.preferredTime} · {item.mode}
                </small>
              </div>
              <code>{item.id.slice(-8)}</code>
              <b>{item.status}</b>
            </div>
          ))}
        </article>
      )}
      {bookingOpen && (
        <div
          className="diagnostic-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Request doctor appointment"
        >
          <button
            className="diagnostic-backdrop"
            onClick={() => setBookingOpen(false)}
            aria-label="Close appointment"
          />
          <section className="surface appointment-modal">
            <div className="diagnostic-modal-head">
              <div>
                <span className="kicker">
                  <CalendarDays size={14} /> Appointment request
                </span>
                <h2>Request a consultation</h2>
                <p>Dr. Ananya Mehta · Sample workflow</p>
              </div>
              <button onClick={() => setBookingOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {bookingConfirmation ? (
              <div className="appointment-success">
                <span>
                  <Check size={28} />
                </span>
                <h3>Request saved successfully</h3>
                <p>Private appointment reference</p>
                <strong>{bookingConfirmation}</strong>
                <small>
                  The request is visible only inside your authenticated Firebase
                  account. Email/WhatsApp opens separately for delivery to the
                  doctor.
                </small>
                <button
                  className="primary-btn"
                  onClick={() => setBookingOpen(false)}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="appointment-grid">
                  <label>
                    <span>Preferred date</span>
                    <input
                      required
                      min={new Date().toISOString().slice(0, 10)}
                      type="date"
                      value={appointment.date}
                      onChange={(event) =>
                        setAppointment((current) => ({
                          ...current,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Preferred time</span>
                    <input
                      required
                      type="time"
                      value={appointment.time}
                      onChange={(event) =>
                        setAppointment((current) => ({
                          ...current,
                          time: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="wide">
                    <span>Consultation mode</span>
                    <select
                      value={appointment.mode}
                      onChange={(event) =>
                        setAppointment((current) => ({
                          ...current,
                          mode: event.target.value,
                        }))
                      }
                    >
                      <option>Video consultation</option>
                      <option>Clinic appointment</option>
                      <option>Phone consultation</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>
                      Brief reason (avoid unnecessary sensitive details)
                    </span>
                    <textarea
                      maxLength={300}
                      value={appointment.reason}
                      onChange={(event) =>
                        setAppointment((current) => ({
                          ...current,
                          reason: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="appointment-check wide">
                    <input
                      type="checkbox"
                      checked={appointment.shareReport}
                      onChange={(event) =>
                        setAppointment((current) => ({
                          ...current,
                          shareReport: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      I may share a selected report after appointment
                      confirmation.
                    </span>
                  </label>
                  <div className="appointment-location wide">
                    <div>
                      <LocateFixed size={17} />
                      <span>
                        <strong>Current location</strong>
                        <small>
                          {patientLocation
                            ? `${patientLocation.latitude}, ${patientLocation.longitude} · accuracy ~${patientLocation.accuracy} m`
                            : "Optional. Shared only with your explicit choice."}
                        </small>
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={locationWorking}
                      onClick={requestLocation}
                    >
                      {locationWorking ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <MapPin size={15} />
                      )}
                      {patientLocation ? "Update location" : "Use my location"}
                    </button>
                    {patientLocation && (
                      <label>
                        <input
                          type="checkbox"
                          checked={appointment.shareLocation}
                          onChange={(event) =>
                            setAppointment((current) => ({
                              ...current,
                              shareLocation: event.target.checked,
                            }))
                          }
                        />
                        Share this location with the doctor
                      </label>
                    )}
                  </div>
                  <label className="appointment-check wide">
                    <input
                      type="checkbox"
                      checked={appointment.consent}
                      onChange={(event) =>
                        setAppointment((current) => ({
                          ...current,
                          consent: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      I consent to saving and sending this appointment request
                      to the selected doctor.
                    </span>
                  </label>
                </div>
                {bookingError && (
                  <div className="error-box">
                    <AlertTriangle size={16} />
                    {bookingError}
                  </div>
                )}
                <div className="appointment-actions">
                  <button
                    disabled={bookingWorking || !appointment.consent}
                    className="secondary-btn"
                    onClick={() => submitAppointment("email")}
                  >
                    {bookingWorking ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Mail size={16} />
                    )}{" "}
                    Save & email
                  </button>
                  <button
                    disabled={bookingWorking || !appointment.consent}
                    className="primary-btn"
                    onClick={() => submitAppointment("whatsapp")}
                  >
                    {bookingWorking ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <MessageCircleHeart size={16} />
                    )}{" "}
                    Save & WhatsApp
                  </button>
                </div>
                <p className="demo-contact-note">
                  Demo contact is used until an approved doctor email and
                  WhatsApp Business number are configured.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function SettingsView({
  dark,
  setDark,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const [notifications, setNotifications] = useState(true);
  const [ocr, setOcr] = useState(true);
  const [offline, setOffline] = useState(false);
  return (
    <section className="settings-grid">
      <article className="surface settings-card">
        <span className="kicker">Appearance</span>
        <h3>Interface preferences</h3>
        <SettingRow
          icon={dark ? Moon : Sun}
          title="Dark mode"
          detail="Use a low-glare charcoal interface"
        >
          <Toggle checked={dark} setChecked={setDark} />
        </SettingRow>
        <SettingRow icon={Languages} title="Language" detail="English (India)">
          <button className="select-btn">
            English <ChevronRight size={15} />
          </button>
        </SettingRow>
      </article>
      <article className="surface settings-card">
        <span className="kicker">Health services</span>
        <h3>Features & connectivity</h3>
        <SettingRow
          icon={Bell}
          title="Notifications"
          detail="Receive health and device alerts"
        >
          <Toggle checked={notifications} setChecked={setNotifications} />
        </SettingRow>
        <SettingRow
          icon={FileSearch}
          title="Browser OCR"
          detail="Process reports locally"
        >
          <Toggle checked={ocr} setChecked={setOcr} />
        </SettingRow>
        <SettingRow
          icon={CloudOff}
          title="Offline mode"
          detail="Use local demo data"
        >
          <Toggle checked={offline} setChecked={setOffline} />
        </SettingRow>
      </article>
    </section>
  );
}

function SettingRow({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: typeof Activity;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <span className="setting-icon">
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  setChecked,
}: {
  checked: boolean;
  setChecked: (value: boolean) => void;
}) {
  return (
    <button
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => setChecked(!checked)}
      aria-label="Toggle setting"
    >
      <span />
    </button>
  );
}

function AboutView() {
  return (
    <section className="about-card surface">
      <span className="brand-mark">
        <HeartPulse size={34} />
      </span>
      <span className="kicker">About Sanjeevni-AI Health</span>
      <h2>Health information you can actually understand.</h2>
      <p>
        Validated screening models, Firebase-connected sensors, private browser
        OCR and understandable report guidance in one healthcare workspace.
      </p>
      <div className="about-grid">
        <div>
          <ShieldCheck size={22} />
          <strong>Privacy & consent</strong>
          <span>
            Private profiles are account-scoped. Consent can be withdrawn and
            account data deleted from the profile menu.
          </span>
        </div>
        <div>
          <BrainCircuit size={22} />
          <strong>Decision support</strong>
          <span>
            AI explains readings for education. It does not diagnose, prescribe
            medicines or replace a registered clinician.
          </span>
        </div>
        <div>
          <Activity size={22} />
          <strong>Emergency safety</strong>
          <span>
            Urgent symptoms should be escalated to emergency services or a
            qualified clinician; never rely only on this application.
          </span>
        </div>
      </div>
      <div className="about-details">
        <article>
          <span className="kicker">Privacy notice · गोपनीयता सूचना</span>
          <h3>Your choice, your health data</h3>
          <p>
            We process profile, report and sensor data only for requested health
            features. Give consent before saving medical details. You may
            withdraw consent and delete your account data. हम केवल आपकी सहमति और
            चुनी गई सुविधाओं के लिए स्वास्थ्य डेटा का उपयोग करते हैं। आप किसी भी
            समय सहमति वापस लेकर डेटा मिटा सकते हैं।
          </p>
        </article>
        <article>
          <span className="kicker">Clinical safety · चिकित्सीय सुरक्षा</span>
          <h3>Educational support—not diagnosis</h3>
          <p>
            Reference ranges vary by laboratory and patient context. Verify OCR
            and sensor readings with the original source and a qualified
            clinician. यह ऐप निदान या दवा का विकल्प नहीं है। असामान्य परिणाम पर
            योग्य डॉक्टर से संपर्क करें।
          </p>
        </article>
        <article>
          <span className="kicker">ABHA & ABDM</span>
          <h3>Optional and consent-based</h3>
          <p>
            Entering an ABHA address is optional. Sanjeevni-AI does not claim
            official ABDM integration until the required sandbox,
            consent-manager and production approvals are completed.
          </p>
        </article>
        <article>
          <span className="kicker">Regulatory status</span>
          <h3>Not a registered medical device</h3>
          <p>
            Sanjeevni-AI is currently educational screening and monitoring
            software. Hardware or diagnostic claims require applicable
            validation and CDSCO regulatory review before clinical marketing.
          </p>
        </article>
      </div>
      <div className="about-capabilities">
        <a
          href="https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025.pdf"
          target="_blank"
          rel="noreferrer"
        >
          DPDP Rules 2025
        </a>
        <a
          href="https://esanjeevani.mohfw.gov.in/assets/guidelines/Telemedicine_Practice_Guidelines.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Telemedicine Guidelines
        </a>
        <a
          href="https://abdm.gov.in/abha-PRIVACY-POLICY-english"
          target="_blank"
          rel="noreferrer"
        >
          ABDM Privacy
        </a>
        <a
          href="https://cdsco.mohfw.gov.in/opencms/opencms/en/Medical-Device-Diagnostics/"
          target="_blank"
          rel="noreferrer"
        >
          CDSCO Medical Devices
        </a>
      </div>
      <div className="copyright-block">
        <strong>
          © {new Date().getFullYear()}{" "}
          <a
            href="https://cloud.mongodb.com/v2#/org/6a27a0578ace5dc1b1aa1aff"
            target="_blank"
            rel="noreferrer"
          >
            Synapse Neural Technologies Pvt. Ltd.
          </a>
        </strong>
        <span>
          © {new Date().getFullYear()} Akshat Sharma. All rights reserved.
        </span>
        <small>
          Version 5.2 · Educational screening and monitoring support · Not a
          medical device
        </small>
      </div>
    </section>
  );
}
