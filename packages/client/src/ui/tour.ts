interface TourStep {
  title: string;
  body: string;
  /** HUD selector to spotlight; omitted → a centered card with no highlight. */
  target?: string;
}

const STEPS: readonly TourStep[] = [
  {
    title: 'Willkommen bei CAC',
    body: 'Ziel ist es, die gegnerische Basis zu zerstören. Keine Eile: Die KI greift die ersten rund 10 Minuten nicht an – genug Zeit, um deine Basis aufzubauen.',
  },
  {
    title: 'Basis bauen',
    body: 'Rechts baust du: eine Kachel anklicken → das Gebäude wird gebaut → erneut klicken und auf der Karte platzieren. Sinnvolle Reihenfolge: Kraftwerk → Raffinerie → Kaserne oder Waffenfabrik.',
    target: '#sidebar',
  },
  {
    title: 'Wirtschaft & Strom',
    body: 'Dein Sammler holt automatisch Erz und bringt es zur Raffinerie – das ist dein Geld. Behalte oben den Strombalken im Auge: Zu wenig Strom legt Verteidigung lahm und bremst die Produktion.',
    target: '#resources',
  },
  {
    title: 'Einheiten steuern',
    body: 'Mit Linksklick oder Aufziehen eines Rahmens wählst du Einheiten aus. Rechtsklick schickt sie los – auf leeren Boden bewegen, auf einen Gegner angreifen.',
  },
  {
    title: 'Übersicht & Kamera',
    body: 'Bewege die Kamera mit WASD/Pfeiltasten oder Leertaste + Ziehen. Ein Klick auf die Minimap springt sofort zu dieser Stelle.',
    target: '#minimap-wrap',
  },
  {
    title: 'Mehr Hilfe',
    body: 'Der „?"-Button oben links zeigt dir jederzeit alle Tastenkürzel – und startet diese Kurzeinführung erneut. Viel Erfolg, Kommandant!',
    target: '#help-btn',
  },
];

const STORAGE_KEY = 'cac.onboarded';

/**
 * Short first-run onboarding tour: a series of cards that briefly explain the
 * game and spotlight the matching HUD element. Purely client-side UI. Shows
 * once (localStorage), is skippable, and can be reopened from the help menu.
 */
export class OnboardingTour {
  private readonly overlay = document.getElementById('tour')!;
  private readonly highlight = document.getElementById('tour-highlight')!;
  private readonly stepEl = document.getElementById('tour-step')!;
  private readonly titleEl = document.getElementById('tour-title')!;
  private readonly bodyEl = document.getElementById('tour-body')!;
  private readonly backBtn = document.getElementById('tour-back') as HTMLButtonElement;
  private readonly nextBtn = document.getElementById('tour-next') as HTMLButtonElement;
  private index = 0;

  constructor() {
    this.backBtn.addEventListener('click', () => this.go(this.index - 1));
    this.nextBtn.addEventListener('click', () => this.go(this.index + 1));
    document.getElementById('tour-skip')!.addEventListener('click', () => this.finish());
    window.addEventListener('keydown', (e) => {
      if (!this.overlay.classList.contains('open')) return;
      if (e.key === 'Escape') this.finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') this.go(this.index + 1);
      else if (e.key === 'ArrowLeft') this.go(this.index - 1);
    });
    // Keep the spotlight aligned if the window is resized mid-tour.
    window.addEventListener('resize', () => {
      if (this.overlay.classList.contains('open')) this.render();
    });
    // Reopen from the help menu.
    document.getElementById('tour-open')?.addEventListener('click', () => {
      document.getElementById('help')?.classList.remove('open');
      this.open();
    });
  }

  /** Shows the tour once, on the player's first game. */
  maybeShowOnFirstRun(): void {
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* private mode: just show it */
    }
    if (!seen) this.open();
  }

  /** Starts the tour at the first step. */
  open(): void {
    this.index = 0;
    this.overlay.classList.add('open');
    this.render();
  }

  private go(to: number): void {
    if (to < 0) return;
    if (to >= STEPS.length) {
      this.finish();
      return;
    }
    this.index = to;
    this.render();
  }

  private finish(): void {
    this.overlay.classList.remove('open');
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  private render(): void {
    const step = STEPS[this.index]!;
    this.stepEl.textContent = `${this.index + 1} / ${STEPS.length}`;
    this.titleEl.textContent = step.title;
    this.bodyEl.textContent = step.body;
    this.backBtn.style.visibility = this.index === 0 ? 'hidden' : 'visible';
    this.nextBtn.textContent = this.index === STEPS.length - 1 ? "Los geht's!" : 'Weiter';

    const el = step.target ? document.querySelector(step.target) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      const pad = 6;
      this.highlight.style.display = 'block';
      this.highlight.style.left = `${r.left - pad}px`;
      this.highlight.style.top = `${r.top - pad}px`;
      this.highlight.style.width = `${r.width + pad * 2}px`;
      this.highlight.style.height = `${r.height + pad * 2}px`;
    } else {
      this.highlight.style.display = 'none';
    }
  }
}
