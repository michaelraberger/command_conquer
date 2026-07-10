import Swiper from 'swiper';
import { Navigation, Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

interface ChangelogEntry {
  id: string;
  date: string;
  title: string;
  text: string;
  /** Screenshot path relative to the Vite base, e.g. "changelog/foo.png". */
  image: string;
}

const STORAGE_KEY = 'cac.changelogSeen';
/** Mirror of the onboarding tour's key (tour.ts) — used to detect first runs. */
const ONBOARDED_KEY = 'cac.onboarded';

/**
 * "Was ist neu": a corner link plus a Swiper carousel of changelog entries
 * (screenshot + text each) loaded from public/changelog.json. Auto-opens over
 * the start screen when entries newer than the last-seen one exist — except on
 * a genuine first run, where the onboarding tour takes precedence and the
 * newest entry is silently marked seen instead.
 */
export class Changelog {
  private readonly overlay = document.getElementById('changelog')!;
  private readonly link = document.getElementById('changelog-link')!;
  private readonly wrapper = this.overlay.querySelector('.swiper-wrapper') as HTMLElement;
  private entries: ChangelogEntry[] = [];
  private swiper: Swiper | null = null;

  constructor() {
    this.link.addEventListener('click', (e) => {
      e.preventDefault();
      this.open();
    });
    this.overlay.querySelector('.changelog-x')!.addEventListener('click', () => this.close());
    document.getElementById('changelog-close')!.addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.close(); // click outside the card
    });
    // Capture phase so Esc/arrows never reach the game's window-level hotkeys
    // (placement cancel, camera panning) while the modal is open.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.overlay.classList.contains('open')) return;
        e.stopPropagation();
        if (e.key === 'Escape') this.close();
        else if (e.key === 'ArrowRight') this.swiper?.slideNext();
        else if (e.key === 'ArrowLeft') this.swiper?.slidePrev();
      },
      true,
    );
  }

  /** Loads changelog.json, builds the slides and sets the "NEU" badge. */
  async init(): Promise<void> {
    try {
      const res = await fetch('changelog.json');
      if (res.ok) this.entries = (await res.json()) as ChangelogEntry[];
    } catch {
      /* missing/broken changelog.json: feature stays dormant */
    }
    this.buildSlides();
    // First run ever: the onboarding tour has priority — nothing here is
    // "news" to a brand-new player, so mark everything seen silently.
    let onboarded = false;
    try {
      onboarded = localStorage.getItem(ONBOARDED_KEY) === '1';
    } catch {
      /* private mode */
    }
    if (!onboarded && this.readSeenId() === null) {
      this.markSeen();
      return;
    }
    // Stored id vanished from the data (renamed/pruned entries): never nag —
    // treat everything as seen and repair the key.
    const storedId = this.readSeenId();
    if (storedId !== null && this.entries.length > 0 && this.unseenCount() === this.entries.length) {
      const known = this.entries.some((entry) => entry.id === storedId);
      if (!known) this.markSeen();
    }
    this.updateBadge();
  }

  /** Auto-popup when there is something the player has not seen yet. */
  maybeAutoOpen(): void {
    if (this.entries.length > 0 && this.unseenCount() > 0) this.open();
  }

  private readSeenId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /** Entries newer than the stored one (array is newest-first). */
  private unseenCount(): number {
    if (this.entries.length === 0) return 0;
    const storedId = this.readSeenId();
    if (storedId === null) return this.entries.length;
    const idx = this.entries.findIndex((entry) => entry.id === storedId);
    return idx === -1 ? this.entries.length : idx;
  }

  private buildSlides(): void {
    this.wrapper.replaceChildren();
    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'swiper-slide';
      empty.innerHTML = '<div class="cl-empty">Noch keine Einträge.</div>';
      this.wrapper.appendChild(empty);
      return;
    }
    for (const entry of this.entries) {
      const slide = document.createElement('div');
      slide.className = 'swiper-slide';
      const img = document.createElement('img');
      img.src = entry.image;
      img.alt = entry.title;
      img.loading = 'lazy';
      // Missing screenshot: keep the (aspect-ratio-sized) dark panel instead
      // of the browser's broken-image icon + alt text.
      img.addEventListener('error', () => {
        img.style.visibility = 'hidden';
      });
      const date = document.createElement('div');
      date.className = 'cl-date';
      date.textContent = entry.date;
      const title = document.createElement('h3');
      title.textContent = entry.title;
      const text = document.createElement('p');
      text.textContent = entry.text;
      slide.append(img, date, title, text);
      this.wrapper.appendChild(slide);
    }
  }

  private open(): void {
    this.overlay.classList.add('open');
    if (this.swiper === null) {
      // Lazy init: created only once the container is visible — Swiper would
      // measure 0 width inside display:none.
      this.swiper = new Swiper(this.overlay.querySelector('.swiper') as HTMLElement, {
        modules: [Navigation, Pagination],
        navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        pagination: { el: '.swiper-pagination', clickable: true },
        spaceBetween: 24,
        observer: true,
        observeParents: true,
      });
    } else {
      this.swiper.update();
    }
    this.swiper.slideTo(0, 0);
  }

  private close(): void {
    this.overlay.classList.remove('open');
    this.markSeen();
    this.updateBadge();
  }

  private markSeen(): void {
    if (this.entries.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, this.entries[0]!.id);
    } catch {
      /* private mode: badge simply reappears next load */
    }
  }

  private updateBadge(): void {
    this.link.classList.toggle('unseen', this.unseenCount() > 0);
  }
}
