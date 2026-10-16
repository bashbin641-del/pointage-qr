'use client';

import Image from 'next/image';
import { useState } from 'react';

type ScannerState = 'ready' | 'checking' | 'error';

export default function Home() {
  const [state, setState] = useState<ScannerState>('ready');
  function startScan() {
    setState('checking');
    window.setTimeout(() => setState('error'), 800);
  }
  const message = state === 'checking' ? 'Vérification en cours…' : state === 'error' ? 'Aucun pointage n’a été confirmé. Réessayez lorsque le QR est visible.' : 'Présentez le QR de votre carte.';
  return (
    <main className="borne-shell theme-borne">
      <section className="borne-card" aria-live="polite">
        <Image className="brand-logo" src="/brand/inox-logo.png" alt="INOX Technologies" width={150} height={106} priority />
        <p className="eyebrow">INOX PRÉSENCE</p>
        <h1>Pointage</h1>
        <p className="lead">{message}</p>
        <div className={`scan-frame ${state}`} aria-hidden="true"><span /></div>
        <button className="primary-button" type="button" onClick={startScan} disabled={state === 'checking'}>{state === 'checking' ? 'Vérification…' : 'Scanner une carte'}</button>
        <p className="helper">Le pointage est confirmé uniquement après validation du serveur.</p>
      </section>
    </main>
  );
}
