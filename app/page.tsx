"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { subscribeToCoreEvents } from "@/lib/realtime";

type Terminal = { id: string; name: string; site: { name: string; timezone: string } | null };
type ScannerState = "ready" | "starting" | "scanning" | "checking" | "success" | "error";
const storageKey = "inox-presence-terminal-session-v1";
const cameraPermissionTimeoutMs = 10_000;
const cameraStartupTimeoutMs = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

async function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNSUPPORTED");
  let requestExpired = false;
  const request = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" } },
  });
  void request.then((stream) => {
    if (requestExpired) stream.getTracks().forEach((track) => track.stop());
  }).catch(() => undefined);
  try {
    return await withTimeout(request, cameraPermissionTimeoutMs, "CAMERA_PERMISSION_TIMEOUT");
  } catch (error) {
    requestExpired = true;
    throw error;
  }
}

function cameraErrorMessage(error: unknown) {
  const detail = error as { name?: string; message?: string };
  if (detail.name === "NotAllowedError" || detail.name === "SecurityError") return "Accès à la caméra refusé. Autorisez-le dans le navigateur puis réessayez.";
  if (detail.name === "NotFoundError" || detail.name === "DevicesNotFoundError") return "Aucune caméra n’est disponible sur cet appareil.";
  if (detail.message === "CAMERA_PERMISSION_TIMEOUT") return "La demande d’accès à la caméra n’a pas reçu de réponse. Vérifiez l’autorisation du navigateur puis réessayez.";
  if (detail.message === "CAMERA_START_TIMEOUT") return "Le flux vidéo n’a pas pu démarrer. Vérifiez la caméra puis réessayez.";
  if (detail.message === "CAMERA_UNSUPPORTED") return "Ce navigateur ne permet pas l’accès à la caméra.";
  return "Caméra indisponible. Vérifiez son autorisation dans le navigateur puis réessayez.";
}

function apiUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!base) throw new Error("API_URL_MISSING");
  const root = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
  return `${root}/${path}`;
}

function errorMessage(status: number, code?: string) {
  if (status === 410 || code?.includes("EXPIRE")) return "Ce QR a expiré ou a déjà été utilisé. Demandez un nouveau code.";
  if (status === 401) return "La session de cette borne a expiré. Réactivez le terminal.";
  if (status === 403) return "Ce QR ou ce terminal n’est pas autorisé pour ce site.";
  if (status === 503) return "Vérification momentanément indisponible. Aucun pointage n’a été confirmé.";
  return "Le pointage n’a pas été confirmé. Réessayez avec un nouveau QR.";
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const processingRef = useRef(false);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [state, setState] = useState<ScannerState>("ready");
  const [message, setMessage] = useState("Présentez le QR de votre carte.");
  const [activationCode, setActivationCode] = useState("");
  const [activationPending, setActivationPending] = useState(false);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop(); controlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const deactivateTerminal = useCallback((reason: string) => {
    stopCamera();
    window.localStorage.removeItem(storageKey);
    setTerminal(null);
    setSessionToken("");
    setState("error");
    setMessage(reason);
  }, [stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    const token = window.localStorage.getItem(storageKey);
    if (!token) { window.queueMicrotask(() => setCheckingSession(false)); return; }
    void fetch(apiUrl("terminaux/session"), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); const result = await response.json() as { terminal: Terminal }; setSessionToken(token); setTerminal(result.terminal); })
      .catch(() => window.localStorage.removeItem(storageKey))
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!sessionToken) return;
    return subscribeToCoreEvents("events/terminal", {
      getAccessToken: async () => sessionToken,
      onEvent: (event) => {
        if (event.type === "terminal.session_revoked") {
          deactivateTerminal("La session de cette borne a été remplacée. Saisissez le nouveau code d’activation.");
        }
      },
      onUnauthorized: () => deactivateTerminal("La session de cette borne a expiré. Saisissez un nouveau code d’activation."),
    });
  }, [deactivateTerminal, sessionToken]);

  async function activate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setActivationPending(true); setMessage("");
    try {
      const response = await fetch(apiUrl("terminaux/activation"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: activationCode.trim().toUpperCase() }) });
      const result = await response.json() as { sessionToken?: string; terminal?: Terminal; message?: string };
      if (!response.ok || !result.sessionToken || !result.terminal) throw new Error(result.message);
      window.localStorage.setItem(storageKey, result.sessionToken); setSessionToken(result.sessionToken); setTerminal(result.terminal); setState("ready"); setMessage("Terminal activé. Vous pouvez démarrer le scanner.");
    } catch { setMessage("Code invalide ou expiré. Demandez un nouveau code à un administrateur."); setState("error"); }
    finally { setActivationPending(false); }
  }

  async function submitScan(payload: string) {
    if (processingRef.current) return;
    processingRef.current = true; stopCamera(); setState("checking"); setMessage("Vérification par le serveur…");
    try {
      const response = await fetch(apiUrl("pointages/scanner"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ qrPayload: payload, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { event?: { event_type: "entree" | "sortie"; occurred_at: string }; message?: string };
      if (!response.ok || !result.event) { if (response.status === 401) { window.localStorage.removeItem(storageKey); setTerminal(null); setSessionToken(""); } throw Object.assign(new Error(result.message), { status: response.status, code: result.message }); }
      const time = new Intl.DateTimeFormat("fr-CI", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Abidjan" }).format(new Date(result.event.occurred_at));
      setState("success"); setMessage(`${result.event.event_type === "entree" ? "Entrée" : "Sortie"} enregistrée à ${time}.`);
    } catch (error) { const detail = error as { status?: number; code?: string }; setState("error"); setMessage(errorMessage(detail.status ?? 500, detail.code)); }
    finally { processingRef.current = false; }
  }

  async function startScan() {
    if (!terminal || !sessionToken) return;
    stopCamera(); setState("starting"); setMessage("Autorisation de la caméra…");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
      if (!videoRef.current) throw new Error("VIDEO_MISSING");
      const stream = await requestCamera();
      let startupExpired = false;
      const startup = reader.decodeFromStream(stream, videoRef.current, (result) => { if (result) void submitScan(result.getText()); });
      void startup.then((lateControls) => { if (startupExpired) lateControls.stop(); }).catch(() => undefined);
      let controls: IScannerControls;
      try {
        controls = await withTimeout(startup, cameraStartupTimeoutMs, "CAMERA_START_TIMEOUT");
      } catch (error) {
        startupExpired = true;
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }
      controlsRef.current = controls; setState("scanning"); setMessage("Cadrez le QR dans la zone de lecture.");
    } catch (error) { stopCamera(); setState("error"); setMessage(cameraErrorMessage(error)); }
  }

  if (checkingSession) return <main className="borne-shell theme-borne"><section className="borne-card"><p>Vérification du terminal…</p></section></main>;
  if (!terminal) return <main className="borne-shell theme-borne"><section className="borne-card"><Image className="brand-logo" src="/brand/inox-logo.png" alt="INOX Technologies" width={150} height={106} priority /><p className="eyebrow">INOX PRÉSENCE</p><h1>Activer cette borne</h1><p className="lead">Saisissez le code à 12 caractères généré depuis l’administration.</p><form className="activation-form" onSubmit={activate}><label>Code d’activation<input value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} minLength={12} maxLength={12} required autoComplete="one-time-code" placeholder="A1B2C3D4E5F6" /></label>{message ? <p className={state === "error" ? "status-error" : "helper"} role={state === "error" ? "alert" : "status"}>{message}</p> : null}<button className="primary-button" disabled={activationPending || activationCode.trim().length !== 12}>{activationPending ? "Activation…" : "Activer le terminal"}</button></form></section></main>;
  return <main className="borne-shell theme-borne"><section className="borne-card" aria-live="polite"><Image className="brand-logo" src="/brand/inox-logo.png" alt="INOX Technologies" width={150} height={106} priority /><p className="eyebrow">INOX PRÉSENCE</p><h1>Pointage</h1><p className="terminal-name">{terminal.name} · {terminal.site?.name}</p><p className="lead">{message}</p><div className={`scan-frame ${state}`}><video ref={videoRef} muted playsInline aria-label="Aperçu de la caméra" /><span aria-hidden="true" /></div><button className="primary-button" type="button" onClick={() => void startScan()} disabled={state === "starting" || state === "checking" || state === "scanning"}>{state === "scanning" ? "Scanner actif" : state === "checking" ? "Vérification…" : "Démarrer le scanner"}</button>{state === "scanning" ? <button className="quiet-button" type="button" onClick={() => { stopCamera(); setState("ready"); setMessage("Scanner arrêté. Aucun pointage n’a été envoyé."); }}>Arrêter la caméra</button> : null}<p className="helper">Le pointage est confirmé uniquement après validation du serveur.</p></section></main>;
}
