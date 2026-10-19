"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

type Terminal = { id: string; name: string; site: { name: string; timezone: string } | null };
type ScannerState = "ready" | "starting" | "scanning" | "checking" | "success" | "error";
const storageKey = "inox-presence-terminal-session-v1";

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

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    const token = window.localStorage.getItem(storageKey);
    if (!token) { window.queueMicrotask(() => setCheckingSession(false)); return; }
    void fetch(apiUrl("terminaux/session"), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); const result = await response.json() as { terminal: Terminal }; setSessionToken(token); setTerminal(result.terminal); })
      .catch(() => window.localStorage.removeItem(storageKey))
      .finally(() => setCheckingSession(false));
  }, []);

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
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => { if (result) void submitScan(result.getText()); });
      controlsRef.current = controls; setState("scanning"); setMessage("Cadrez le QR dans la zone de lecture.");
    } catch { stopCamera(); setState("error"); setMessage("Caméra indisponible. Autorisez son accès dans le navigateur puis réessayez."); }
  }

  if (checkingSession) return <main className="borne-shell theme-borne"><section className="borne-card"><p>Vérification du terminal…</p></section></main>;
  if (!terminal) return <main className="borne-shell theme-borne"><section className="borne-card"><Image className="brand-logo" src="/brand/inox-logo.png" alt="INOX Technologies" width={150} height={106} priority /><p className="eyebrow">INOX PRÉSENCE</p><h1>Activer cette borne</h1><p className="lead">Saisissez le code à 12 caractères généré depuis l’administration.</p><form className="activation-form" onSubmit={activate}><label>Code d’activation<input value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} minLength={12} maxLength={12} required autoComplete="one-time-code" placeholder="A1B2C3D4E5F6" /></label>{message ? <p className={state === "error" ? "status-error" : "helper"} role={state === "error" ? "alert" : "status"}>{message}</p> : null}<button className="primary-button" disabled={activationPending || activationCode.trim().length !== 12}>{activationPending ? "Activation…" : "Activer le terminal"}</button></form></section></main>;
  return <main className="borne-shell theme-borne"><section className="borne-card" aria-live="polite"><Image className="brand-logo" src="/brand/inox-logo.png" alt="INOX Technologies" width={150} height={106} priority /><p className="eyebrow">INOX PRÉSENCE</p><h1>Pointage</h1><p className="terminal-name">{terminal.name} · {terminal.site?.name}</p><p className="lead">{message}</p><div className={`scan-frame ${state}`}><video ref={videoRef} muted playsInline aria-label="Aperçu de la caméra" /><span aria-hidden="true" /></div><button className="primary-button" type="button" onClick={() => void startScan()} disabled={state === "starting" || state === "checking" || state === "scanning"}>{state === "scanning" ? "Scanner actif" : state === "checking" ? "Vérification…" : "Démarrer le scanner"}</button>{state === "scanning" ? <button className="quiet-button" type="button" onClick={() => { stopCamera(); setState("ready"); setMessage("Scanner arrêté. Aucun pointage n’a été envoyé."); }}>Arrêter la caméra</button> : null}<p className="helper">Le pointage est confirmé uniquement après validation du serveur.</p></section></main>;
}
