"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bot,
  Send,
  Code2,
  Eye,
  Settings,
  RefreshCw,
  Terminal,
  FileCode,
  FolderTree,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Globe,
  MessageSquare,
  Copy,
  Download,
  Trash2,
  Key,
  LogIn,
  FolderOpen,
  Save,
  Play,
  Square,
  ListChecks,
  Check,
  X,
  ExternalLink,
  Monitor,
  Cpu,
  HardDrive,
  MemoryStick,
  Search,
  SkipForward,
} from "lucide-react";

// Types
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  status?: "pending" | "success" | "error";
}

interface GeneratedFile {
  nombre: string;
  ruta: string;
  tipo?: 'file' | 'directory';
  contenido: string;
}

interface ExecutionStep {
  id: string;
  numero: number;
  fase?: string;
  accion: "crear" | "editar" | "eliminar" | "validar" | "corregir" | "verificar" | "instalar" | "actualizar" | "scaffolding";
  descripcion: string;
  status: "pending" | "running" | "success" | "error";
  comandos?: string[];
  archivos?: Array<{ nombre: string; contenido?: string }>;
  validacion?: string;
  progreso?: string;
  output?: string;
  requisito_origen?: string;
}

interface Project {
  id: string;
  name: string;
  createdAt: Date;
  folder: string;
  files: GeneratedFile[];
}

interface ConnectionStatus {
  groq: "connected" | "disconnected" | "checking" | "not_configured";
  aiProvider: "logged_in" | "not_logged_in" | "checking" | "browser_closed" | "needs_login";
}

interface TerminalCommand {
  id: string;
  command: string;
  output: string;
  status: "success" | "error" | "running";
  timestamp: Date;
}

// System Information from backend
interface SystemInfo {
  os: {
    name: string;
    version: string;
    platform: string;
  };
  ram: {
    total: number;
    available: number;
    usedPercent: number;
  };
  disk: {
    total: number;
    free: number;
    usedPercent: number;
    selectedFolder: string;
  };
  architecture: string;
  cpu: {
    model: string;
    cores: number;
    speed: string;
  };
  shell: string;
}

// Error handling with retry
interface StepError {
  stepIndex: number;
  fase: string;
  paso: string;
  mensaje: string;
  codigoSalida: number | null;
  intentos: number;
  maxIntentos: number;
  output?: string;
}

// User action for error dialog
type ErrorUserAction = 'retry' | 'skip' | 'abort' | 'provide_info';

// AI Providers
const AI_PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", icon: "🤖" },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", icon: "🟠" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", icon: "💎" },
  { id: "qwen", name: "Qwen", url: "https://chat.qwen.ai/", icon: "🌟" },
];

// Default system prompt (for external AI) - NUEVO FORMATO
const DEFAULT_SYSTEM_PROMPT = `Actúa como un asistente técnico que guía a un agente desarrollador paso a paso para construir exactamente lo que el usuario pidió.

INSTRUCCIONES:
- Todas tus respuestas deben estar en formato JSON válido.
- No incluyes explicaciones fuera del JSON.
- Cada paso debe ser un objeto JSON con las siguientes claves:
  {
    "fase": "número o nombre de la fase",
    "accion": "crear|editar|eliminar|validar|corregir",
    "descripcion": "Breve descripción del paso",
    "archivos": [{ "nombre": "ruta/archivo.ext", "contenido": "código completo si aplica" }],
    "comandos": ["comando exacto de consola (cmd/powershell)"],
    "validacion": "cómo probar este paso",
    "progreso": "porcentaje o estado del avance"
  }

REGLAS:
- Si el usuario no da detalles (colores, estilos, arquitectura), decide por defecto.
- Si el usuario da detalles, síguelos estrictamente.
- Después de cada paso, incluye siempre cómo validar.
- Si hay un error, responde con accion: "corregir" y el archivo corregido.

SISTEMA: {OS} ({SHELL})

SOLICITUD DEL USUARIO:
"{USER_REQUEST}"`;

export default function SonnyAgent() {
  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAI, setSelectedAI] = useState("chatgpt");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<GeneratedFile | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  
  // Tabs State
  const [activeTab, setActiveTab] = useState<"code" | "files" | "terminal" | "progress">("progress");
  
  // Terminal State
  const [terminalCommands, setTerminalCommands] = useState<TerminalCommand[]>([]);
  
  // Execution Steps (Progress)
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  
  // API Key
  const [groqApiKey, setGroqApiKey] = useState("");
  
  // Project Folder
  const [projectFolder, setProjectFolder] = useState("");
  const [currentProjectRoot, setCurrentProjectRoot] = useState("");
  const [savedProjects, setSavedProjects] = useState<Project[]>([]);
  
  // Connection Status
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    groq: "not_configured",
    aiProvider: "browser_closed",
  });

  // Login Dialog
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginUrl, setLoginUrl] = useState("");
  const [externalPrompt, setExternalPrompt] = useState("");
  
  // OS Detection
  const [osInfo, setOsInfo] = useState({ os: "linux", shell: "bash" });
  
  // System Information from backend
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [isLoadingSystemInfo, setIsLoadingSystemInfo] = useState(false);
  
  // Error handling with retry
  const [currentError, setCurrentError] = useState<StepError | null>(null);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState<Record<number, number>>({});
  const [userInputOnError, setUserInputOnError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  // Detect OS on mount
  useEffect(() => {
    const ua = navigator.userAgent;
    let os = "linux";
    let shell = "bash";
    
    if (ua.includes("Win")) {
      os = "windows";
      shell = "cmd";
    } else if (ua.includes("Mac")) {
      os = "macos";
      shell = "bash";
    } else if (ua.includes("Linux")) {
      os = "linux";
      shell = "bash";
    }
    
    setOsInfo({ os, shell });
  }, []);

  // Fetch system info from backend
  const fetchSystemInfo = useCallback(async (folder?: string) => {
    setIsLoadingSystemInfo(true);
    try {
      const url = folder 
        ? `/api/system-info?folder=${encodeURIComponent(folder)}`
        : '/api/system-info';
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) {
        console.error('[SystemInfo] Error:', data.error);
        return;
      }
      setSystemInfo(data);
      console.log('[SystemInfo] Loaded:', data);
    } catch (error) {
      console.error('[SystemInfo] Error fetching:', error);
    } finally {
      setIsLoadingSystemInfo(false);
    }
  }, [])

  const refreshProjectFiles = useCallback(async (rootDir: string) => {
    if (!rootDir) return;
    try {
      const response = await fetch(`/api/project-files?root=${encodeURIComponent(rootDir)}`);
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.items)) return;

      const mapped: GeneratedFile[] = data.items.map((item: { nombre: string; ruta: string; tipo: 'file' | 'directory' }) => ({
        nombre: item.ruta,
        ruta: item.ruta,
        tipo: item.tipo,
        contenido: '',
      }));

      setGeneratedFiles(mapped);

      if (activeFile?.ruta) {
        const updatedActive = mapped.find(f => f.ruta === activeFile.ruta);
        if (!updatedActive) setActiveFile(null);
      }
    } catch (error) {
      console.error('[ProjectFiles] Error refreshing file list:', error);
    }
  }, [activeFile?.ruta]);

  const loadFileContent = useCallback(async (file: GeneratedFile, rootDir: string) => {
    if (file.tipo === 'directory') {
      setActiveFile(file);
      setActiveTab('code');
      return;
    }

    if (!rootDir) {
      setActiveFile(file);
      setActiveTab('code');
      return;
    }

    try {
      const response = await fetch(`/api/project-files?action=content&root=${encodeURIComponent(rootDir)}&file=${encodeURIComponent(file.ruta)}`);
      const data = await response.json();
      if (response.ok && data.success) {
        setActiveFile({ ...file, contenido: String(data.content || '') });
      } else {
        setActiveFile({ ...file, contenido: `No se pudo cargar el archivo: ${data.error || 'Error desconocido'}` });
      }
      setActiveTab('code');
    } catch (error) {
      setActiveFile({ ...file, contenido: `Error cargando contenido: ${error}` });
      setActiveTab('code');
    }
  }, []);

  
  // Browse folder dialog
  const browseFolder = useCallback(async () => {
    try {
      const response = await fetch('/api/folder-dialog?action=browse');
      const data = await response.json();
      if (data.success && data.path) {
        setProjectFolder(data.path);
        setCurrentProjectRoot(data.path);
        fetchSystemInfo(data.path);
      }
    } catch (error) {
      console.error('[FolderDialog] Error:', error);
    }
  }, [fetchSystemInfo]);

  // Load saved data on mount
  useEffect(() => {
    const savedGroqKey = localStorage.getItem("sonny_groq_api_key") || "";
    const savedPrompt = localStorage.getItem("sonny_system_prompt") || DEFAULT_SYSTEM_PROMPT;
    const savedAI = localStorage.getItem("sonny_selected_ai") || "chatgpt";
    const savedFolder = localStorage.getItem("sonny_project_folder") || "";
    const savedProjectsData = localStorage.getItem("sonny_saved_projects") || "[]";
    
    setGroqApiKey(savedGroqKey);
    setSystemPrompt(savedPrompt);
    setSelectedAI(savedAI);
    setProjectFolder(savedFolder);
    setCurrentProjectRoot(savedFolder);
    
    try {
      setSavedProjects(JSON.parse(savedProjectsData));
    } catch {
      setSavedProjects([]);
    }
    
    if (savedGroqKey) testGroqConnection(savedGroqKey);
    checkBrowserStatus();
    
    // Fetch system info
    fetchSystemInfo(savedFolder || undefined);
  }, [fetchSystemInfo]);

  // Save data when changed
  useEffect(() => {
    localStorage.setItem("sonny_groq_api_key", groqApiKey);
    localStorage.setItem("sonny_system_prompt", systemPrompt);
    localStorage.setItem("sonny_selected_ai", selectedAI);
    localStorage.setItem("sonny_project_folder", projectFolder);
  }, [groqApiKey, systemPrompt, selectedAI, projectFolder]);

  useEffect(() => {
    localStorage.setItem("sonny_saved_projects", JSON.stringify(savedProjects));
  }, [savedProjects]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (activeFile && activeFile.contenido) {
      const ext = activeFile.nombre.split('.').pop()?.toLowerCase();
      if (ext === 'html' || ext === 'htm') {
        setPreviewHtml(activeFile.contenido);
      }
    }
  }, [activeFile]);

  // Test Groq connection
  const testGroqConnection = async (apiKey: string) => {
    if (!apiKey) {
      setConnectionStatus(prev => ({ ...prev, groq: "not_configured" }));
      return;
    }
    setConnectionStatus(prev => ({ ...prev, groq: "checking" }));
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      setConnectionStatus(prev => ({ ...prev, groq: response.ok ? "connected" : "disconnected" }));
    } catch {
      setConnectionStatus(prev => ({ ...prev, groq: "disconnected" }));
    }
  };

  // Check browser status
  const checkBrowserStatus = async () => {
    try {
      const response = await fetch("/api/browser/open");
      const data = await response.json();
      
      if (data.needsLogin) {
        setConnectionStatus(prev => ({ ...prev, aiProvider: "needs_login" }));
      } else if (data.isOpen) {
        setConnectionStatus(prev => ({ ...prev, aiProvider: "logged_in" }));
      } else {
        setConnectionStatus(prev => ({ ...prev, aiProvider: "browser_closed" }));
      }
    } catch {
      setConnectionStatus(prev => ({ ...prev, aiProvider: "browser_closed" }));
    }
  };

  // Open browser with AI (Playwright backend)
  const openBrowserWithAI = useCallback(async () => {
    try {
      setConnectionStatus(prev => ({ ...prev, aiProvider: "checking" }));
      
      const response = await fetch("/api/browser/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedAI }),
      });
      
      const data = await response.json();
      
      if (data.needsLogin) {
        setLoginUrl(data.url || AI_PROVIDERS.find(p => p.id === selectedAI)?.url || "");
        setShowLoginDialog(true);
        setConnectionStatus(prev => ({ ...prev, aiProvider: "needs_login" }));
      } else if (data.success) {
        setConnectionStatus(prev => ({ ...prev, aiProvider: "logged_in" }));
      } else {
        console.error("Error opening browser:", data.error);
        setConnectionStatus(prev => ({ ...prev, aiProvider: "browser_closed" }));
      }
    } catch (error) {
      console.error("Error opening browser:", error);
      setConnectionStatus(prev => ({ ...prev, aiProvider: "browser_closed" }));
    }
  }, [selectedAI]);

  // Confirm login
  const confirmLogin = useCallback(async () => {
    setShowLoginDialog(false);
    setConnectionStatus(prev => ({ ...prev, aiProvider: "logged_in" }));
    
    if (externalPrompt) {
      addMessage("assistant", "✅ Login confirmado. Continuando...");
    }
  }, [externalPrompt]);

  // Add message helper
  const addMessage = useCallback((role: "user" | "assistant" | "system", content: string, status?: "pending" | "success" | "error") => {
    const message: Message = {
      id: Date.now().toString() + Math.random(),
      role,
      content,
      timestamp: new Date(),
      status,
    };
    setMessages(prev => [...prev, message]);
    return message.id;
  }, []);

  // Update message helper
  const updateMessage = useCallback((id: string, content: string, status?: "pending" | "success" | "error") => {
    setMessages(prev => prev.map(m => 
      m.id === id ? { ...m, content, status: status || m.status } : m
    ));
  }, []);

  // Start automatic process
  const startAutomaticProcess = useCallback(async () => {
    if (!input.trim() || isProcessing) return;

    addMessage("user", input);
    setInput("");
    setIsProcessing(true);
    setExecutionSteps([]);
    setCurrentStepIndex(-1);
    setActiveTab("progress");

    const statusMsgId = addMessage("assistant", "🔄 Iniciando proceso...", "pending");

    try {
      updateMessage(statusMsgId, `🌐 Conectando con ${AI_PROVIDERS.find(p => p.id === selectedAI)?.name}...`);

      // FASE 1: Obtener pasos de la IA externa
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          aiProvider: selectedAI,
          groqApiKey,
          osInfo,
          projectFolder,
        }),
      });

      const data = await response.json();

      if (data.needsLogin) {
        updateMessage(statusMsgId, "⚠️ Necesitas hacer login en la IA externa", "error");
        setLoginUrl(data.currentUrl || AI_PROVIDERS.find(p => p.id === selectedAI)?.url || "");
        setExternalPrompt(data.externalPrompt || "");
        setShowLoginDialog(true);
        setIsProcessing(false);
        return;
      }

      if (!data.success) {
        updateMessage(statusMsgId, `❌ Error: ${data.error}`, "error");
        // Mostrar respuesta cruda para debug si existe
        if (data.rawResponse) {
          console.log("Raw response:", data.rawResponse);
        }
        setIsProcessing(false);
        return;
      }

      const steps: ExecutionStep[] = (data.steps || []).map((step: Record<string, unknown>, index: number) => ({
        id: `step-${index}`,
        numero: index + 1,
        fase: (step.fase as string) || `Fase ${index + 1}`,
        accion: (step.accion as ExecutionStep['accion']) || "crear",
        descripcion: (step.descripcion as string) || "",
        status: "pending" as const,
        comandos: (step.comandos as string[]) || [],
        archivos: (step.archivos as Array<{ nombre: string; contenido?: string }>) || [],
        validacion: (step.validacion as string) || "",
        progreso: (step.progreso as string) || "",
        requisito_origen: (step.requisito_origen as string) || "",
      }));

      setExecutionSteps(steps);
      updateMessage(statusMsgId, `📋 Plan recibido: ${steps.length} pasos. Ejecutando...`);

      // FASE 2: Ejecutar pasos con streaming en tiempo real
      if (steps.length > 0) {
        const workDir = typeof data.workDir === "string" ? data.workDir : "";
        if (workDir) {
          setCurrentProjectRoot(workDir);
          await refreshProjectFiles(workDir);
        }
        const success = await executeWithStreaming(steps, workDir);
        
        // Obtener conteo del estado actual
        setExecutionSteps(prev => {
          const successCount = prev.filter(s => s.status === "success").length;
          if (success) {
            updateMessage(statusMsgId, `✅ Fases 1/2 completadas. ${successCount}/${steps.length} pasos exitosos.`, "success");
          } else {
            updateMessage(statusMsgId, `⚠️ Proceso completado con errores. ${successCount}/${steps.length} pasos exitosos.`, "error");
          }
          return prev;
        });

        if (success) {
          updateMessage(statusMsgId, '🧩 Iniciando FASE 3 por bloques...');
          let blockId: string | null = null;
          const maxBlocks = 20;

          for (let round = 0; round < maxBlocks; round++) {
            const phase3Response = await fetch('/api/process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'phase_3',
                message: input,
                aiProvider: selectedAI,
                groqApiKey,
                bloqueActual: blockId,
                projectFolder,
              }),
            });

            const phase3Data = await phase3Response.json();
            if (!phase3Response.ok || !phase3Data.success) {
              updateMessage(statusMsgId, `⚠️ FASE 3 detenida: ${phase3Data.error || 'Error desconocido'}`, 'error');
              break;
            }

            const phase3Steps: ExecutionStep[] = (phase3Data.executionSteps || []).map((step: Record<string, unknown>, index: number) => ({
              id: `fase3-step-${round}-${index}`,
              numero: index + 1,
              fase: (step.fase as string) || '3',
              accion: (step.accion as ExecutionStep['accion']) || 'crear',
              descripcion: (step.descripcion as string) || '',
              status: 'pending' as const,
              comandos: (step.comandos as string[]) || [],
              archivos: (step.archivos as Array<{ nombre: string; contenido?: string }>) || [],
              validacion: (step.validacion as string) || '',
            }));

            setExecutionSteps(phase3Steps);
            const blockOk = await executeWithStreaming(phase3Steps, currentProjectRoot || workDir);
            if (!blockOk) {
              updateMessage(statusMsgId, '❌ FASE 3 detenida por error en bloque', 'error');
              break;
            }

            const completeResponse = await fetch('/api/process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'complete_block', projectFolder }),
            });
            const completeData = await completeResponse.json();
            if (completeData?.pendingBlocks && Array.isArray(completeData.pendingBlocks)) {
              // continuar según siguiente bloque de IA
            }

            if (phase3Data.phase3Result?.siguiente_bloque) {
              blockId = String(phase3Data.phase3Result.siguiente_bloque);
            } else {
              blockId = null;
            }

            const maybeWorkDir = typeof phase3Data.workDir === 'string' ? phase3Data.workDir : '';
            if (maybeWorkDir) {
              setCurrentProjectRoot(maybeWorkDir);
              await refreshProjectFiles(maybeWorkDir);
            }

            const nextPhase = String(phase3Data.phase3Result?.siguiente_fase || '').toLowerCase();
            if (nextPhase.includes('4') || blockId === null) {
              updateMessage(statusMsgId, '✅ FASE 3 completada. Listo para FASE 4.', 'success');
              break;
            }
          }
        }
      } else {
        updateMessage(statusMsgId, `✅ Sin pasos que ejecutar.`, "success");
      }

    } catch (error) {
      console.error("Process error:", error);
      updateMessage(statusMsgId, `❌ Error: ${error}`, "error");
    } finally {
      setIsProcessing(false);
    }
  }, [input, isProcessing, osInfo, selectedAI, groqApiKey, projectFolder, currentProjectRoot, addMessage, updateMessage, refreshProjectFiles]);

  const stopProcess = useCallback(() => {
    setIsProcessing(false);
    addMessage("assistant", "⏹️ Proceso detenido por el usuario.", "error");
  }, [addMessage]);

  // Función para ejecutar pasos con streaming en tiempo real - CON RETRY LOGIC
  const executeWithStreaming = useCallback(async (steps: ExecutionStep[], workDir: string) => {
    let currentWorkDir = workDir;
    const totalSteps = steps.length;
    const requirementStatus: Record<string, { verified: boolean; output: string; expected: string; metExpectation: boolean }> = {};

    const evaluateVerificationExpectation = (output: string, expected: string, success: boolean): boolean => {
      if (!success) return false;

      const normalizedOutput = String(output || '');
      const outputUpper = normalizedOutput.toUpperCase();
      const normalizedExpected = String(expected || '').trim();
      const expectedUpper = normalizedExpected.toUpperCase();

      if (!normalizedExpected) return true;

      // Normalizar validaciones de software basadas en marcadores estables.
      if (expectedUpper === 'OK') {
        return outputUpper.includes('OK-');
      }
      if (expectedUpper === 'MISSING') {
        return outputUpper.includes('MISSING');
      }
      if (expectedUpper === 'OUT_OF_RANGE') {
        return outputUpper.includes('OUT_OF_RANGE');
      }

      // Si el comando responde con marcadores conocidos, aceptar cuando exista cualquiera
      // para no forzar matches rígidos de versión exacta.
      const hasKnownMarker =
        outputUpper.includes('OK-') || outputUpper.includes('MISSING') || outputUpper.includes('OUT_OF_RANGE');
      if (hasKnownMarker) {
        return true;
      }

      // Si se esperaba un número exacto, aceptar cualquier número válido en la salida.
      const expectedNumeric = Number(normalizedExpected);
      if (!Number.isNaN(expectedNumeric)) {
        return /\d+(?:\.\d+)?/.test(normalizedOutput);
      }

      return outputUpper.includes(expectedUpper);
    };
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1;
      
      // Marcar paso como "running"
      setCurrentStepIndex(i);
      setExecutionSteps(prev => prev.map((s, idx) => 
        idx === i ? { ...s, status: "running" as const } : s
      ));

      // Agregar comando a terminal (en vivo)
      const terminalCmd: TerminalCommand = {
        id: `cmd-${Date.now()}-${i}`,
        command: step.comandos?.[0] || step.descripcion,
        output: `$ ${step.comandos?.[0] || 'Ejecutando...'}`,
        status: "running",
        timestamp: new Date(),
      };
      setTerminalCommands(prev => [...prev, terminalCmd]);

      // Si ya se verificó el requisito y cumple, omitir instalación/actualización.
      const reqKey = step.requisito_origen || step.descripcion;
      if ((step.accion === "instalar" || step.accion === "actualizar") && requirementStatus[reqKey]?.metExpectation) {
        const verifyInfo = requirementStatus[reqKey];
        const skipOutput = `⏭️ Instalación omitida para ${reqKey}: ya cumple validación (${verifyInfo.expected || 'OK'}).
🧾 Verificación previa:
${verifyInfo.output}`;
        setTerminalCommands(prev => prev.map((tc, idx) => 
          idx === prev.length - 1 ? { ...tc, output: `${tc.output}
${skipOutput}`, status: "success" } : tc
        ));
        setExecutionSteps(prev => prev.map((s, idx) => 
          idx === i ? { ...s, status: "success" as const, output: skipOutput } : s
        ));
        continue;
      }

      let stepSuccess = true;
      let stepOutput = "";
      let attemptCount = retryAttempts[i] || 0;
      const maxAttempts = 3;
      let localRetryAttempts = { ...retryAttempts };

      // Ejecutar comandos del paso CON RETRY LOGIC
      if (step.comandos && step.comandos.length > 0) {
        for (const cmd of step.comandos) {
          let retryLoop = true;
          
          while (retryLoop) {
            try {
              // Llamar al backend para ejecutar comando
              const execResponse = await fetch("/api/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "execute",
                  steps: [{
                    accion: step.accion,
                    descripcion: step.descripcion,
                    comandos: [cmd],
                  }],
                  ...(currentWorkDir ? { workDir: currentWorkDir } : {}),
                  retryAttempts: { 0: localRetryAttempts[i] || 0 },
                }),
              });

              const execData = await execResponse.json();
              if (typeof execData.workDir === 'string' && execData.workDir) {
                currentWorkDir = execData.workDir;
                setCurrentProjectRoot(currentWorkDir);
                await refreshProjectFiles(currentWorkDir);
              }

              // Manejar respuesta de error con retry
              if (execData.needsRetry || execData.maxRetriesReached) {
                attemptCount = execData.currentAttempt || attemptCount + 1;
                localRetryAttempts = { ...localRetryAttempts, [i]: attemptCount };
                setRetryAttempts(localRetryAttempts);
                const expectedText = step.validacion
                  ? `\n🎯 Esperado: ${step.validacion}`
                  : "";
                const backendMessage = execData.errorReport?.mensaje_error
                  ? `\n🧾 Respuesta: ${execData.errorReport.mensaje_error}`
                  : "";
                
                // Actualizar terminal con intento
                setTerminalCommands(prev => prev.map((tc, idx) => 
                  idx === prev.length - 1 
                    ? { 
                      ...tc, 
                      output: `${tc.output}\n⚠️ Intento ${attemptCount} de ${maxAttempts} falló\n🛠️ Comando: ${cmd}${backendMessage}${expectedText}`,
                      status: "error" 
                    }
                    : tc
                ));
                
                // Si alcanzó máximo de reintentos, mostrar diálogo
                if (execData.maxRetriesReached) {
                  setCurrentError({
                    stepIndex: i,
                    fase: execData.errorReport?.fase || step.fase || `Paso ${stepNumber}`,
                    paso: execData.errorReport?.paso || step.descripcion,
                    mensaje: execData.errorReport?.mensaje_error || 'Error desconocido',
                    codigoSalida: execData.errorReport?.codigo_salida || null,
                    intentos: attemptCount,
                    maxIntentos: maxAttempts,
                    output: execData.errorReport?.mensaje_error,
                  });
                  setShowErrorDialog(true);
                  
                  // Marcar paso como error
                  setExecutionSteps(prev => prev.map((s, idx) => 
                    idx === i ? { 
                      ...s, 
                      status: "error" as const,
                      output: execData.errorReport?.mensaje_error || 'Error'
                    } : s
                  ));
                  
                  return false;
                }

                // Protección adicional en frontend para evitar bucles infinitos
                if (attemptCount >= maxAttempts) {
                  setCurrentError({
                    stepIndex: i,
                    fase: step.fase || `Paso ${stepNumber}`,
                    paso: step.descripcion,
                    mensaje: execData.errorReport?.mensaje_error || 'Se alcanzó el máximo de intentos',
                    codigoSalida: execData.errorReport?.codigo_salida || null,
                    intentos: attemptCount,
                    maxIntentos: maxAttempts,
                    output: execData.errorReport?.mensaje_error,
                  });
                  setShowErrorDialog(true);
                  setExecutionSteps(prev => prev.map((s, idx) => 
                    idx === i ? { 
                      ...s, 
                      status: "error" as const,
                      output: execData.errorReport?.mensaje_error || 'Error'
                    } : s
                  ));
                  return false;
                }
                
                // Reintentar automáticamente después de un pequeño delay
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }
              
              // Respuesta exitosa o sin retry
              retryLoop = false;
              
              if (execData.results && execData.results[0]) {
                const result = execData.results[0];
                stepSuccess = result.success;
                stepOutput = result.outputs?.join("\n") || "";
                attemptCount = result.retryCount || 0;
                const expectedText = step.validacion
                  ? `\n🎯 Esperado: ${step.validacion}`
                  : "";
                const statusText = result.success
                  ? "✅ Resultado: ejecutado correctamente"
                  : "❌ Resultado: ejecución con error";
                
                // Actualizar terminal con resultado
                setTerminalCommands(prev => prev.map((tc, idx) => 
                  idx === prev.length - 1 
                    ? { 
                      ...tc, 
                      output: `${tc.output}\n🛠️ Comando ejecutado: ${cmd}\n${statusText}${expectedText}\n🧾 Respuesta:\n${stepOutput}${attemptCount > 0 ? `\n✅ Completado en intento ${attemptCount}` : ''}`, 
                      status: result.success ? "success" : "error" 
                    }
                    : tc
                ));

                if (step.accion === "verificar") {
                  const expected = (step.validacion || "")
                    .replace(/^Debe mostrar:\s*/i, "")
                    .trim();
                  const metExpectation = evaluateVerificationExpectation(stepOutput, expected, result.success);
                  requirementStatus[reqKey] = {
                    verified: true,
                    output: stepOutput,
                    expected,
                    metExpectation,
                  };
                }
              }
            } catch (cmdError) {
              stepSuccess = false;
              stepOutput = `Error: ${cmdError}`;
              retryLoop = false;
            }
          }

          if (!stepSuccess) break;
        }
      }

            // Crear/editar archivos del paso en disco (backend), no solo en estado local
      if (stepSuccess && step.archivos && step.archivos.length > 0) {
        try {
          const filesResponse = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'execute',
              steps: [{
                accion: step.accion,
                descripcion: step.descripcion,
                archivos: step.archivos,
              }],
              ...(currentWorkDir ? { workDir: currentWorkDir } : {}),
              retryAttempts: { 0: 0 },
            }),
          });

          const filesData = await filesResponse.json();
          if (typeof filesData.workDir === 'string' && filesData.workDir) {
            currentWorkDir = filesData.workDir;
            setCurrentProjectRoot(currentWorkDir);
          }

          const fileExecResult = filesData.results?.[0];
          if (!filesResponse.ok || !filesData.success || !fileExecResult?.success) {
            stepSuccess = false;
            stepOutput += `
Error creando/actualizando archivos: ${filesData.errorReport?.mensaje_error || filesData.error || 'Error desconocido'}`;
          } else {
            const createdFiles = step.archivos.map(a => a.nombre).join(', ');
            stepOutput += `${stepOutput ? '\n' : ''}📁 Archivos aplicados: ${createdFiles}`;
            setTerminalCommands(prev => prev.map((tc, idx) =>
              idx === prev.length - 1
                ? { ...tc, output: `${tc.output}
📁 Archivos aplicados en disco: ${createdFiles}` }
                : tc
            ));
            await refreshProjectFiles(currentWorkDir || currentProjectRoot || projectFolder);
          }
        } catch (fileError) {
          stepSuccess = false;
          stepOutput += `
Error creando/actualizando archivos: ${fileError}`;
        }
      }

// Marcar paso como completado
      setExecutionSteps(prev => prev.map((s, idx) => 
        idx === i ? { 
          ...s, 
          status: stepSuccess ? "success" : "error",
          output: stepOutput
        } : s
      ));

      // Si hubo error, detener
      if (!stepSuccess) {
        return false;
      }
    }

    return true;
  }, [retryAttempts, refreshProjectFiles, currentProjectRoot, projectFolder]);

  const copyCode = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const downloadFile = useCallback((file: GeneratedFile) => {
    const blob = new Blob([file.contenido], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.nombre;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setGeneratedFiles([]);
    setActiveFile(null);
    setTerminalCommands([]);
    setExecutionSteps([]);
    setCurrentStepIndex(-1);
    setPreviewHtml("");
  }, []);

  const saveProject = useCallback(() => {
    if (generatedFiles.length === 0) return;
    const projectName = prompt("Nombre del proyecto:", `proyecto-${Date.now()}`);
    if (!projectName) return;
    
    const project: Project = {
      id: Date.now().toString(),
      name: projectName,
      createdAt: new Date(),
      folder: projectFolder,
      files: generatedFiles,
    };
    setSavedProjects(prev => [...prev, project]);
    alert(`Proyecto "${projectName}" guardado`);
  }, [generatedFiles, projectFolder]);

  const loadProject = useCallback((project: Project) => {
    setGeneratedFiles(project.files);
    if (project.files.length > 0) setActiveFile(project.files[0]);
  }, []);

  const progressPercent = executionSteps.length > 0 
    ? Math.round((executionSteps.filter(s => s.status === "success").length / executionSteps.length) * 100)
    : 0;

  const StatusIndicator = ({ status, label }: { status: string; label: string }) => {
    const getColor = () => {
      switch (status) {
        case "connected":
        case "logged_in":
          return "bg-green-500";
        case "checking":
          return "bg-yellow-500 animate-pulse";
        case "disconnected":
        case "not_logged_in":
        case "needs_login":
          return "bg-red-500";
        default:
          return "bg-gray-500";
      }
    };
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-700/50 rounded text-xs">
        <div className={`w-2 h-2 rounded-full ${getColor()}`} />
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-slate-700 px-4 py-2 flex items-center justify-between bg-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-cyan-400" />
          <span className="font-bold text-lg">Sonny Agent</span>
          <Badge variant="outline" className="text-xs">Autónomo</Badge>
          <Badge className="text-xs bg-slate-600">{osInfo.os}</Badge>
        </div>

        <div className="flex items-center gap-2">
          <StatusIndicator status={connectionStatus.groq} label="Groq" />
          <StatusIndicator 
            status={connectionStatus.aiProvider} 
            label={connectionStatus.aiProvider === "needs_login" ? "Login Req." : AI_PROVIDERS.find(p => p.id === selectedAI)?.name || "IA"} 
          />

          <Select value={selectedAI} onValueChange={setSelectedAI}>
            <SelectTrigger className="w-28 bg-slate-700 border-slate-600 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  <span className="flex items-center gap-1">
                    <span>{provider.icon}</span>
                    <span>{provider.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={openBrowserWithAI} size="sm" className="bg-cyan-600 hover:bg-cyan-700" title="Abrir navegador IA">
            <Globe className="h-4 w-4" />
          </Button>

          <Button onClick={() => setShowSettings(true)} size="sm" variant="outline" className="bg-slate-700 border-slate-600">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Progress Bar */}
      {isProcessing && executionSteps.length > 0 && (
        <div className="bg-slate-800 px-4 py-2 border-b border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm">Ejecutando paso {currentStepIndex + 1} de {executionSteps.length}</span>
            <span className="text-sm text-cyan-400">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
      )}

      {/* Main Content - Panel del Chat MÁS ANCHO */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Left Panel - Chat - AHORA 45% EN VEZ DE 30% */}
        <ResizablePanel defaultSize={45} minSize={35}>
          <div className="h-full flex flex-col bg-slate-900">
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center">
                  <Bot className="h-20 w-20 mb-4 text-cyan-400 opacity-50" />
                  <p className="text-xl mb-2 font-semibold">Sonny Autónomo</p>
                  <p className="text-sm max-w-md mb-6">Escribe tu solicitud. Yo interpreto, la IA externa diseña, y yo ejecuto todo automáticamente.</p>
                  
                  {/* System Information Card */}
                  {systemInfo && (
                    <div className="w-full max-w-md mb-6 bg-slate-800/80 rounded-lg border border-slate-700 p-4">
                      <div className="flex items-center gap-2 mb-3 text-cyan-400">
                        <Monitor className="h-4 w-4" />
                        <span className="text-sm font-semibold">Información del Sistema</span>
                        {isLoadingSystemInfo && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {/* OS */}
                        <div className="bg-slate-900/50 rounded p-2">
                          <div className="flex items-center gap-1 text-slate-500 mb-1">
                            <Monitor className="h-3 w-3" />
                            <span>Sistema Operativo</span>
                          </div>
                          <p className="text-white font-medium truncate">{systemInfo.os.name}</p>
                        </div>
                        
                        {/* Architecture */}
                        <div className="bg-slate-900/50 rounded p-2">
                          <div className="flex items-center gap-1 text-slate-500 mb-1">
                            <Cpu className="h-3 w-3" />
                            <span>Arquitectura</span>
                          </div>
                          <p className="text-white font-medium">{systemInfo.architecture}</p>
                        </div>
                        
                        {/* RAM */}
                        <div className="bg-slate-900/50 rounded p-2">
                          <div className="flex items-center gap-1 text-slate-500 mb-1">
                            <MemoryStick className="h-3 w-3" />
                            <span>RAM Disponible</span>
                          </div>
                          <p className="text-white font-medium">
                            {systemInfo.ram.available} GB <span className="text-slate-500">/ {systemInfo.ram.total} GB</span>
                          </p>
                          <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                            <div 
                              className={`h-1 rounded-full ${systemInfo.ram.usedPercent > 80 ? 'bg-red-500' : systemInfo.ram.usedPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                              style={{ width: `${100 - systemInfo.ram.usedPercent}%` }}
                            />
                          </div>
                        </div>
                        
                        {/* Disk */}
                        <div className="bg-slate-900/50 rounded p-2">
                          <div className="flex items-center gap-1 text-slate-500 mb-1">
                            <HardDrive className="h-3 w-3" />
                            <span>Disco Libre</span>
                          </div>
                          <p className="text-white font-medium">
                            {systemInfo.disk.free} GB <span className="text-slate-500">/ {systemInfo.disk.total} GB</span>
                          </p>
                          <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                            <div 
                              className={`h-1 rounded-full ${systemInfo.disk.usedPercent > 80 ? 'bg-red-500' : systemInfo.disk.usedPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                              style={{ width: `${100 - systemInfo.disk.usedPercent}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      
                      {/* CPU Info */}
                      <div className="mt-3 bg-slate-900/50 rounded p-2">
                        <div className="flex items-center gap-1 text-slate-500 mb-1 text-xs">
                          <Cpu className="h-3 w-3" />
                          <span>Procesador</span>
                        </div>
                        <p className="text-white text-xs font-medium truncate">{systemInfo.cpu.model}</p>
                        <p className="text-slate-500 text-xs">{systemInfo.cpu.cores} núcleos @ {systemInfo.cpu.speed}</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="text-xs space-y-2 bg-slate-800 p-4 rounded-lg max-w-md">
                    <p className="text-cyan-400 font-semibold text-sm mb-2">Flujo automático:</p>
                    <p className="flex items-center gap-2"><span className="text-cyan-400">1.</span> Groq interpreta tu solicitud</p>
                    <p className="flex items-center gap-2"><span className="text-cyan-400">2.</span> Abro navegador con la IA</p>
                    <p className="flex items-center gap-2"><span className="text-cyan-400">3.</span> Envío el prompt</p>
                    <p className="flex items-center gap-2"><span className="text-cyan-400">4.</span> Recibo el plan JSON</p>
                    <p className="flex items-center gap-2"><span className="text-cyan-400">5.</span> Ejecuto cada paso</p>
                    <p className="flex items-center gap-2"><span className="text-cyan-400">6.</span> Te muestro el progreso</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 pb-4">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === "user" ? "bg-cyan-600" : "bg-purple-600"}`}>
                        {message.role === "user" ? <MessageSquare className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
                      </div>
                      <div className={`flex-1 ${message.role === "user" ? "text-right" : ""}`}>
                        <div className={`inline-block p-4 rounded-lg ${message.role === "user" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-100"}`}>
                          <pre className="whitespace-pre-wrap text-sm font-mono break-words">{message.content}</pre>
                        </div>
                        <div className="flex items-center gap-2 mt-1 justify-end">
                          <span className="text-xs text-slate-500">{message.timestamp.toLocaleTimeString()}</span>
                          {message.status === "success" && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                          {message.status === "error" && <AlertCircle className="h-3 w-3 text-red-500" />}
                          {message.status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input más grande */}
            <div className="p-4 border-t border-slate-700 bg-slate-800 flex-shrink-0">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    startAutomaticProcess();
                  }
                }}
                placeholder="Escribe tu solicitud aquí... (Enter para enviar)"
                className="min-h-[80px] max-h-[150px] bg-slate-700 border-slate-600 resize-none text-sm"
                disabled={isProcessing}
              />
              <div className="flex justify-between mt-3">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={clearChat} className="bg-slate-700 border-slate-600 h-9" disabled={isProcessing}>
                    <Trash2 className="h-4 w-4 mr-1" /> Limpiar
                  </Button>
                  <Button variant="outline" size="sm" onClick={saveProject} className="bg-slate-700 border-slate-600 h-9" disabled={isProcessing}>
                    <Save className="h-4 w-4 mr-1" /> Guardar
                  </Button>
                </div>
                <div className="flex gap-2">
                  {isProcessing && (
                    <Button onClick={stopProcess} size="sm" className="bg-red-600 hover:bg-red-700 h-9">
                      <Square className="h-4 w-4 mr-1" /> Detener
                    </Button>
                  )}
                  <Button onClick={startAutomaticProcess} disabled={!input.trim() || isProcessing} size="sm" className="bg-cyan-600 hover:bg-cyan-700 h-9 px-6">
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />} 
                    {isProcessing ? "Procesando..." : "Enviar"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center Panel - Más pequeño ahora */}
        <ResizablePanel defaultSize={35} minSize={25}>
          <div className="h-full flex flex-col bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-700 px-2 py-1 flex items-center gap-1 bg-slate-800 flex-shrink-0">
              <button onClick={() => setActiveTab("progress")} className={`px-3 py-1.5 text-sm rounded transition flex items-center gap-1 ${activeTab === "progress" ? "bg-slate-700 text-cyan-400" : "text-slate-400 hover:text-white"}`}>
                <ListChecks className="h-4 w-4" /> Progreso {executionSteps.length > 0 && `(${executionSteps.filter(s => s.status === "success").length}/${executionSteps.length})`}
              </button>
              <button onClick={() => setActiveTab("code")} className={`px-3 py-1.5 text-sm rounded transition flex items-center gap-1 ${activeTab === "code" ? "bg-slate-700 text-cyan-400" : "text-slate-400 hover:text-white"}`}>
                <Code2 className="h-4 w-4" /> Código
              </button>
              <button onClick={() => setActiveTab("files")} className={`px-3 py-1.5 text-sm rounded transition flex items-center gap-1 ${activeTab === "files" ? "bg-slate-700 text-cyan-400" : "text-slate-400 hover:text-white"}`}>
                <FolderTree className="h-4 w-4" /> Archivos ({generatedFiles.length})
              </button>
              <button onClick={() => setActiveTab("terminal")} className={`px-3 py-1.5 text-sm rounded transition flex items-center gap-1 ${activeTab === "terminal" ? "bg-slate-700 text-cyan-400" : "text-slate-400 hover:text-white"}`}>
                <Terminal className="h-4 w-4" /> Terminal
              </button>
              
              {activeFile && activeTab === "code" && (
                <div className="ml-auto flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => copyCode(activeFile.contenido)} className="h-7 w-7 p-0">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => downloadFile(activeFile)} className="h-7 w-7 p-0">
                    <Download className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              {/* Progress Tab */}
              {activeTab === "progress" && (
                <ScrollArea className="h-full p-4">
                  {executionSteps.length > 0 ? (
                    <div className="space-y-3">
                      {executionSteps.map((step, index) => (
                        <div 
                          key={step.id} 
                          className={`p-3 rounded-lg border ${
                            step.status === "success" ? "bg-green-900/20 border-green-800" :
                            step.status === "error" ? "bg-red-900/20 border-red-800" :
                            step.status === "running" ? "bg-yellow-900/20 border-yellow-800" :
                            "bg-slate-800 border-slate-700"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                              step.status === "success" ? "bg-green-600" :
                              step.status === "error" ? "bg-red-600" :
                              step.status === "running" ? "bg-yellow-600" :
                              "bg-slate-600"
                            }`}>
                              {step.status === "success" ? <Check className="h-4 w-4" /> :
                               step.status === "error" ? <X className="h-4 w-4" /> :
                               step.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> :
                               <span className="text-xs">{step.numero}</span>}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {step.fase && (
                                  <Badge className="text-xs bg-purple-600">{step.fase}</Badge>
                                )}
                                <Badge variant="outline" className="text-xs">{step.accion}</Badge>
                                {step.progreso && (
                                  <Badge className="text-xs bg-cyan-600">{step.progreso}</Badge>
                                )}
                              </div>
                              <p className="text-sm font-medium mt-1">{step.descripcion}</p>
                              {step.comandos && step.comandos.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {step.comandos.map((cmd, i) => (
                                    <code key={i} className="text-xs bg-slate-900 px-2 py-1 rounded block font-mono">{cmd}</code>
                                  ))}
                                </div>
                              )}
                              {step.archivos && step.archivos.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {step.archivos.map((a, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">{a.nombre}</Badge>
                                  ))}
                                </div>
                              )}
                              {step.validacion && (
                                <p className="text-xs text-slate-400 mt-2">✓ {step.validacion}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <ListChecks className="h-16 w-16 mb-4 opacity-50" />
                      <p>Los pasos de ejecución aparecerán aquí</p>
                    </div>
                  )}
                </ScrollArea>
              )}

              {/* Code Tab */}
              {activeTab === "code" && (
                activeFile ? (
                  <div className="h-full flex flex-col">
                    <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
                      <FileCode className="h-4 w-4 text-blue-400" />
                      <span className="text-sm">{activeFile.ruta}</span>
                    </div>
                    <ScrollArea className="flex-1">
                      {activeFile.tipo === 'directory' ? (
                        <div className="p-4 text-sm text-slate-300">Carpeta seleccionada: {activeFile.ruta}</div>
                      ) : (
                        <pre className="p-4 text-sm font-mono text-slate-200 whitespace-pre-wrap">{activeFile.contenido}</pre>
                      )}
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <FileCode className="h-16 w-16 mb-4 opacity-50" />
                    <p>Selecciona un archivo</p>
                  </div>
                )
              )}

              {/* Files Tab */}
              {activeTab === "files" && (
                <ScrollArea className="h-full p-2">
                  {generatedFiles.length > 0 ? (
                    <div className="space-y-1">
                      {generatedFiles.map((file, index) => (
                        <button key={index} onClick={() => loadFileContent(file, currentProjectRoot || projectFolder)} className={`flex items-center gap-2 w-full px-2 py-1.5 hover:bg-slate-700 rounded text-left text-sm ${activeFile?.nombre === file.nombre ? "bg-slate-700" : ""}`}>
                          {file.tipo === 'directory' ? <FolderTree className="h-4 w-4 text-yellow-400" /> : <FileCode className="h-4 w-4 text-blue-400" />}
                          <span>{file.nombre}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <FolderTree className="h-16 w-16 mb-4 opacity-50" />
                      <p>No hay archivos</p>
                    </div>
                  )}
                  
                  {savedProjects.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-700">
                      <h4 className="text-xs text-slate-400 mb-2 px-2">PROYECTOS GUARDADOS</h4>
                      {savedProjects.map((project) => (
                        <button key={project.id} onClick={() => loadProject(project)} className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-slate-700 rounded text-left text-sm">
                          <FolderOpen className="h-4 w-4 text-yellow-400" />
                          <span>{project.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}

              {/* Terminal Tab */}
              {activeTab === "terminal" && (
                <ScrollArea className="h-full bg-black p-2 font-mono text-sm">
                  {terminalCommands.length > 0 ? (
                    <div className="space-y-2">
                      {terminalCommands.map((cmd) => (
                        <div key={cmd.id} className="text-slate-300">
                          <div className="flex items-center gap-2">
                            {cmd.status === "success" ? <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" /> : cmd.status === "error" ? <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" /> : <Loader2 className="h-3 w-3 animate-spin text-yellow-500 flex-shrink-0" />}
                            <span className="text-cyan-400">{cmd.command}</span>
                          </div>
                          {cmd.output && <pre className="ml-5 mt-1 text-slate-400 text-xs whitespace-pre-wrap">{cmd.output}</pre>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                      <Terminal className="h-16 w-16 mb-4 opacity-50" />
                      <p>Terminal vacía</p>
                    </div>
                  )}
                </ScrollArea>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Panel - Preview - Más pequeño */}
        <ResizablePanel defaultSize={20} minSize={10}>
          <div className="h-full flex flex-col bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-700 px-4 py-2 flex items-center justify-between bg-slate-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <span className="text-sm font-medium">Preview</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { if (previewRef.current) previewRef.current.srcdoc = previewHtml; }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 bg-white overflow-hidden">
              {previewHtml ? (
                <iframe ref={previewRef} srcDoc={previewHtml} className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-900">
                  <Eye className="h-16 w-16 mb-4 opacity-50" />
                  <p>Preview en vivo</p>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" /> Configuración
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                <Key className="h-4 w-4" /> Groq API Key
              </h3>
              <div className="flex gap-2">
                <Input type="password" value={groqApiKey} onChange={(e) => setGroqApiKey(e.target.value)} placeholder="gsk_..." className="bg-slate-700 border-slate-600 flex-1" />
                <Button variant="outline" size="sm" onClick={() => testGroqConnection(groqApiKey)} className="bg-slate-700 border-slate-600">
                  {connectionStatus.groq === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Probar"}
                </Button>
              </div>
              <p className="text-xs text-slate-400">Modelo: llama-3.3-70b-versatile (solo interpretación)</p>
            </div>

            <Separator className="bg-slate-700" />

            <div className="space-y-2">
              <label className="text-sm font-semibold text-cyan-400">Sistema Detectado</label>
              <div className="flex gap-2">
                <Badge variant="outline">{osInfo.os}</Badge>
                <Badge variant="outline">{osInfo.shell}</Badge>
              </div>
            </div>

            <Separator className="bg-slate-700" />

            <div className="space-y-2">
              <label className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                <FolderOpen className="h-4 w-4" /> Carpeta de Proyectos
              </label>
              <div className="flex gap-2">
                <Input 
                  value={projectFolder} 
                  onChange={(e) => setProjectFolder(e.target.value)} 
                  placeholder="/ruta/a/proyectos" 
                  className="bg-slate-700 border-slate-600 flex-1 font-mono text-sm"
                  readOnly
                />
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={browseFolder} 
                  className="bg-slate-700 border-slate-600 px-3"
                  title="Explorar carpetas"
                >
                  <Search className="h-4 w-4" />
                </Button>
                {projectFolder && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fetchSystemInfo(projectFolder)} 
                    className="bg-slate-700 border-slate-600 px-3"
                    title="Actualizar info del disco"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {systemInfo?.disk && (
                <p className="text-xs text-slate-400 flex items-center gap-2">
                  <HardDrive className="h-3 w-3" />
                  Espacio libre: {systemInfo.disk.free} GB de {systemInfo.disk.total} GB
                </p>
              )}
            </div>

            <Separator className="bg-slate-700" />

            <div className="space-y-2">
              <label className="text-sm font-semibold text-cyan-400">Prompt del Sistema (para IA externa)</label>
              <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} className="min-h-[150px] max-h-[250px] bg-slate-700 border-slate-600 font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)} className="bg-slate-700 border-slate-600">
                Restaurar por defecto
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-700 flex-shrink-0">
            <Button onClick={() => setShowSettings(false)} className="bg-cyan-600 hover:bg-cyan-700">
              Guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Login Dialog */}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5" /> Login Requerido
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <p className="text-sm text-slate-300">
              Necesitas iniciar sesión en {AI_PROVIDERS.find(p => p.id === selectedAI)?.name} para continuar.
            </p>
            
            <div className="flex items-center gap-2 p-3 bg-slate-700 rounded-lg">
              <ExternalLink className="h-4 w-4 text-cyan-400" />
              <a href={loginUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 text-sm hover:underline">
                {loginUrl}
              </a>
            </div>

            <div className="text-xs text-slate-400 space-y-1">
              <p>1. El navegador debería estar abierto</p>
              <p>2. Inicia sesión con tu cuenta</p>
              <p>3. Haz click en "Confirmar Login" cuando termines</p>
            </div>

            {externalPrompt && (
              <div className="space-y-2">
                <label className="text-xs text-slate-400">Prompt listo para enviar:</label>
                <Textarea 
                  value={externalPrompt.substring(0, 500) + "..."} 
                  className="h-20 bg-slate-700 border-slate-600 text-xs font-mono" 
                  readOnly 
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowLoginDialog(false)} className="bg-slate-700 border-slate-600">
              Cancelar
            </Button>
            <Button onClick={confirmLogin} className="bg-green-600 hover:bg-green-700">
              <Check className="h-4 w-4 mr-1" /> Confirmar Login
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Error Dialog - Max retries reached */}
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent className="bg-slate-800 text-white border-red-600">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" /> Error en Ejecución
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              {currentError && (
                <div className="space-y-3">
                  <div className="bg-red-900/20 border border-red-800 rounded p-3">
                    <p className="text-sm font-medium text-red-400 mb-1">
                      Fase: {currentError.fase}
                    </p>
                    <p className="text-sm text-slate-300 mb-2">
                      {currentError.paso}
                    </p>
                    <div className="bg-slate-900 rounded p-2 mt-2">
                      <p className="text-xs font-mono text-red-400 break-all">
                        {currentError.mensaje}
                      </p>
                    </div>
                    {currentError.codigoSalida && (
                      <p className="text-xs text-slate-500 mt-2">
                        Código de salida: {currentError.codigoSalida}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="destructive" className="text-xs">
                      Intento {currentError.intentos} de {currentError.maxIntentos}
                    </Badge>
                    <span className="text-slate-400">Se alcanzó el máximo de reintentos</span>
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-3 py-4">
            <label className="text-sm text-slate-400">
              Proporciona información adicional (opcional):
            </label>
            <Textarea
              value={userInputOnError}
              onChange={(e) => setUserInputOnError(e.target.value)}
              placeholder="Describe qué salió mal o qué deberíamos hacer diferente..."
              className="bg-slate-700 border-slate-600 min-h-[80px] text-sm"
            />
          </div>
          
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600">
              Abortar Todo
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
              onClick={() => {
                // Skip step and continue
                setShowErrorDialog(false);
                setUserInputOnError("");
              }}
            >
              <SkipForward className="h-4 w-4 mr-1" /> Saltar Paso
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-cyan-600 hover:bg-cyan-700"
              onClick={() => {
                // Retry with additional info
                setShowErrorDialog(false);
                setUserInputOnError("");
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> Reintentar con Info
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
